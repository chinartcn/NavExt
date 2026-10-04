# cli.js — 项目管理工具

一个零依赖的命令行工具，用于管理 NavExt的扩展、执行构建、一键打包与启动。所有操作都不离开终端。

---

## 目录

- [快速开始](#快速开始)
- [命令一览](#命令一览)
- [扩展管理](#扩展管理)
  - [create — 创建扩展](#create--创建扩展)
  - [list — 列出扩展](#list--列出扩展)
  - [info — 查看详情](#info--查看详情)
  - [enable / disable — 开关扩展](#enable--disable--开关扩展)
  - [add — 加入清单](#add--加入清单)
  - [remove — 删除扩展](#remove--删除扩展)
- [构建与运行](#构建与运行)
  - [build — 合并单文件](#build--合并单文件)
  - [pack — 打包 tar.gz](#pack--打包-targz)
  - [sfx — 生成自解压](#sfx--生成自解压)
  - [start — 构建并启动](#start--构建并启动)
  - [dev — 开发态运行](#dev--开发态运行)
  - [config — 编辑配置](#config--编辑配置)
- [jsx — 子页扩展策略管理](#jsx--子页扩展策略管理)
- [通用选项](#通用选项)
- [生成的文件结构](#生成的文件结构)
- [命名规则](#命名规则)
- [与 server.js 的配合](#与-serverjs-的配合)
- [常见问题](#常见问题)
- [相关文件](#相关文件)

---

## 快速开始

把 `cli.js` 和 `server.js` 放在同一个目录，然后：

```bash
# 创建第一个扩展（交互式，一路回车即可）
node cli.js create darkmode

# 或直接改站点配置
node cli.js config

# 或者一步到位，完全非交互
node cli.js create darkmode "暗色切换" "给页面加主题切换按钮" "Your Name"

# 打包成单个自解压文件
node cli.js sfx

# 一键：构建 + 启动
node cli.js start
```

完成后会生成 .js/darkmode/ 目录，包含完整的模板文件，并自动把 darkmode 追加到 .js/js.list.json。如果服务正在运行，刷新浏览器即可看到效果。

建议加个软链接方便调用：

```bash
# Linux / macOS / Termux
chmod +x cli.js
ln -s "$PWD/cli.js" /usr/local/bin/nav-cli

# 之后可以直接
nav-cli create my-ext
nav-cli pack
```

Windows 上可以把 cli.js 所在目录加入 PATH，或者用 npx 风格的批处理包装。

---

命令一览

扩展管理

命令 别名 说明
create <name> new、init 创建新扩展（交互式，或一步到位）
list ls 列出所有扩展及状态
info <name> show 查看扩展详情
enable <name> — 启用扩展
disable <name> — 禁用扩展
add <name> — 把已有目录加入清单（不创建文件）
remove <name> rm、delete 删除扩展（含目录和清单项）

构建与运行

命令 等价于 说明
build node build.js 生成 server.dist.js（只合并服务端 + 客户端库）
pack node build.js --pack 打包成 app.tar.gz
sfx node build.js --pack --sfx 打包成自解压 app.sh
start 先 build 再启动 server.dist.js 一键构建并启动
dev node server.js 直接运行源码（开发态）
config — 交互式编辑 server.json

其他

命令 说明
help 显示帮助

---

扩展管理

create — 创建扩展

创建一个新的扩展目录，生成模板文件，并自动追加到 js.list.json。

交互式（推荐首次使用）：

```bash
node cli.js create darkmode
```

会依次询问显示名称、描述、作者，每一项都有默认值，直接回车接受：

```
扩展名（目录名）: darkmode
显示名称 (darkmode): 暗色切换
描述: 给页面加主题切换按钮
作者: Your Name

  ✔ 扩展 darkmode 创建成功

  位置  .js/darkmode/
  新建  mod.json, js.json, index.js, styles.css, client.js
  清单  已追加到 .js/js.list.json

  若服务正在运行，刷新浏览器即可看到效果
```

一步到位（非交互，适合脚本）：

```bash
node cli.js create darkmode "暗色切换" "给页面加主题切换按钮" "Your Name"
```

四个位置参数分别是：name、displayName、description、author。后三个可省略。

快速创建（使用默认值）：

```bash
node cli.js create darkmode -y
```

-y 会跳过所有提问，显示名称默认用扩展名，描述和作者留空。必须提供扩展名。

覆盖已存在的扩展：

```bash
node cli.js create darkmode -y -f
```

交互模式下若目录已存在，会询问是否覆盖。-f 会跳过询问。注意：没有 -f 时，已存在的文件会保留不动，只补充缺失的。有 -f 才会重写。 交互模式下答"是"等于 -f——会重写所有文件，包括你改过的。

---

list — 列出扩展

显示清单中的所有扩展及其状态。

```bash
node cli.js list
```

输出示例：

```
  扩展目录  .js
  共 3 个扩展

  名称         显示名称     版本     顺序   状态
  ─────────────────────────────────────────────────
  darkmode     暗色切换     1.0.0    10     启用
  deepseek     DeepSeek     1.2.0    20     启用
  old-stuff    old-stuff    1.0.0    100    禁用
  broken       broken       -        100    目录缺失
```

状态含义：

· 🟢 启用 — mod.json 中 enabled 不为 false
· ⚪ 禁用 — mod.json 中 enabled: false
· 🔴 目录缺失 — 清单里有，但磁盘上没有对应目录

排序规则：先按 order 升序，同序时按名称字母序。

---

info — 查看详情

显示单个扩展的完整信息，包括元数据、注入配置和目录文件。

```bash
node cli.js info darkmode
```

输出示例：

```
  暗色切换

  目录      .js/darkmode/
  ID        darkmode
  版本      1.0.0
  作者      Your Name
  描述      给页面加主题切换按钮
  顺序      10
  状态      启用

  注入配置
    styles   styles.css
    scripts  client.js

  文件
    mod.json     (240 B)
    js.json      (92 B)
    index.js     (1.1 KB)
    styles.css   (156 B)
    client.js    (420 B)
```

---

enable / disable — 开关扩展

临时启用或禁用扩展，不需要删除目录。

```bash
node cli.js disable darkmode
node cli.js enable darkmode
```

这会修改 mod.json 里的 enabled 字段：

```json
{ "enabled": false }
```

禁用的扩展不会被加载，页面效果等同于它不存在。适合临时排查问题或做 A/B 对比。

---

add — 加入清单

如果你手工创建了一个扩展目录，或者从别的地方拷贝过来，可以用 add 把它加进清单。

```bash
node cli.js add my-ext
```

这只更新 js.list.json，不会创建或修改任何扩展文件。与 create 的区别：

场景 用哪个
从零开始新建 create
已有目录，只是没在清单里 add

目录不存在时 add 会报错，不做任何修改。

---

remove — 删除扩展

彻底删除扩展，包括目录和清单项。

```bash
node cli.js remove darkmode
```

默认会先确认：

```
  确认删除扩展 "darkmode"？（目录将被删除） (y/N): y
  已删除  .js/darkmode/
  已移除  .js/js.list.json

  ✔ 扩展 darkmode 已删除
```

加 -y 跳过确认（适合脚本化）：

```bash
node cli.js remove darkmode -y
```

如果目录和清单项只有一个存在，也能正确删除。两个都不存在时报错退出。

---

构建与运行

build — 合并单文件

等价于 node build.js，把 .navext.client.js 内联进 server.js，生成 server.dist.js。其他文件（HTML、扩展、资源）保持独立。

```bash
node cli.js build
```

适用场景：需要单文件的服务端 + 客户端库，但保留项目目录结构，方便调试。

---

pack — 打包 tar.gz

等价于 node build.js --pack，生成 app.tar.gz。包含：

· server.dist.js（服务端 + 客户端库）
· start.sh（一键启动脚本）
· 所有 HTML / CSS / JS / 图片 / 字体 / 媒体
· server.json / html.json / README.md
· .js/ 扩展目录

```bash
node cli.js pack
```

用户可以这样使用：

```bash
tar xzf app.tar.gz
cd app
./start.sh
```

---

sfx — 生成自解压

等价于 node build.js --pack --sfx，生成单文件自解压 app.sh。内含 base64 编码的 tar.gz，用户拿到一个文件就能跑。

```bash
node cli.js sfx
```

用户侧：

```bash
chmod +x app.sh
./app.sh                            # 解压到临时目录并启动
./app.sh --keep ./myapp             # 解压到 ./myapp，保留文件
./app.sh --extract ./myapp          # 只解压，不启动
./app.sh --port 8080                # 传给 server 的参数
```

依赖：任何 POSIX shell + base64 + gzip + tar + Node.js 14+。macOS / Linux / Termux 默认都有。

这是分发首选。用户不需要知道 tar.gz 长什么样，一个文件丢过去就行。

---

start — 构建并启动

先执行 build 生成 server.dist.js，然后启动它。等价于：

```bash
node cli.js build && node server.dist.js
```

```bash
node cli.js start

# 传给 server 的参数
node cli.js start -- --port 8080
```

信号处理：start 会转发 SIGINT / SIGTERM 给子进程，Ctrl+C 能正常停止服务。

适用场景：想在"发布版行为"下测试，又不想每次手动跑两条命令。

---

dev — 开发态运行

直接运行 server.js（不带内联的客户端库），等价于：

```bash
node server.js
```

```bash
node cli.js dev

# 传给 server 的参数
node cli.js dev -- --port 8080
```

适用场景：日常开发。改 .navext.client.js 后刷新页面即生效（mtime 缓存），无需重启服务。

信号处理：同 start，转发 SIGINT / SIGTERM。

---

config — 编辑配置

交互式编辑 `server.json`——逐项询问，回车保留原值，`-` 清空，`Ctrl+C` 取消。

```bash
node cli.js config             # 全量交互
node cli.js config --show      # 只显示当前配置，不修改
node cli.js config --advanced  # 加上 api / extensions 高级项
```

**提问顺序**：

1. `site.title` — 站点标题
2. `site.description` — 站点描述
3. `site.logo` — Logo（emoji 或短文本）
4. `site.footer` — 页脚文字
5. `site.accent` — 主题色（如 `#4f6ef7`）
6. `site.showStats` — 显示文件统计（y/n）
7. `port` — 监听端口
8. `host` — 监听地址
9. `depth` — 扫描深度
10. `ignoreDirs` — 忽略目录（逗号分隔）
11. `ignoreFiles` — 忽略文件（逗号分隔）
12. `htmlExtensions` — HTML 扩展名（逗号分隔）
13. `home.enabled` — 启用自定义主页（y/n）
14. `home.file` — 主页文件（仅 enabled 时问）
15. `home.applyExtensions` — 主页应用扩展注入（y/n）

加 `--advanced` 时继续问：

- `api.enabled` — 启用 API
- `api.writable` — 允许写操作
- `extensions.enabled` — 启用扩展系统

**默认值**：每一项的默认值从当前 `server.json` 读取——直接回车保留原值。

**备份**：保存前自动复制到 `server.json.bak.<时间戳>`。

**取消**：中途 `Ctrl+C` 会退出进程，**不会**写文件。只有跑到最后一步才保存。

**不动**：`home.routes`（数组嵌套，直接编辑 `server.json` 更稳）、`api.fs.*`、`extensions.dir` / `extensions.configFile`。

**历史字段迁移**：如果 `server.json` 里存在 `extensions` 字段且为数组（v1.7 之前的写法），`config` 会自动迁移到 `htmlExtensions`——`server.js` 把 `extensions` 当作扩展系统配置对象，数组形式会被忽略。

**没有非交互模式**：`config` 始终是交互式的。想脚本化批量改，直接用 `node -e` 读写 `server.json`。

---

jsx — 子页扩展策略管理

管理各目录下的 `jsx.json`——声明该目录禁用的扩展。

```bash
node cli.js jsx list             # 列出所有 jsx.json
node cli.js jsx show /docs       # 查看 /docs 的累积策略
node cli.js jsx check            # 检查 ID 是否有效
```

jsx list

递归查找项目下所有 `jsx.json`，按路径列出。

jsx show <path>

对给定路径，打印检查链（root → 最深目录）和累积结果——哪些扩展允许、哪些禁用、禁用的来源是哪个 jsx.json。

```bash
node cli.js jsx show /docs
```

jsx check

扫描所有 jsx.json 里的扩展 ID，检查是否存在于 `js.list.json`。拼错 ID 会提示。

---

通用选项

所有命令都支持这些选项：

选项 简写 说明
--root <dir> -r 指定根目录（默认当前目录）仅扩展管理用
--yes -y 跳过确认，使用默认值
--force -f 覆盖已存在的扩展（仅 create 用）
--no-color — 关闭彩色输出
--help -h 显示帮助

config 命令额外支持 `--show`（只显示不修改）和 `--advanced`（含 api / extensions 高级项），见 [config — 编辑配置](#config--编辑配置)。

在别的目录管理扩展：

```bash
node cli.js list -r ./docs
node cli.js create my-ext -r ./docs -y
```

等号写法也支持：

```bash
node cli.js list --root=./docs
```

管道或重定向时自动关闭颜色：

```bash
node cli.js list > extensions.txt
# 或者
node cli.js list | cat
```

如果没有自动检测出来，可以显式关闭：

```bash
node cli.js list --no-color
```

--root 的边界

--root 只影响扩展管理命令（create / list / info / enable / disable / add / remove）。构建命令（build / pack / sfx / start / dev）始终在 cli.js 所在目录查找 build.js 和 server.js。

如果你把 cli.js 和 server.js 放在一起（推荐），直接 node cli.js build 就行。如果分开放，构建命令需要手动调用 build.js：

```bash
cd /path/to/project
node build.js                # 用项目里的 build.js，没问题
node /path/to/cli.js build   # 会失败，因为 cli.js 和项目不同目录
```

---

生成的文件结构

create 会生成以下文件：

```
.js/<name>/
├── mod.json           # 元数据
├── js.json            # 声明式注入配置
├── index.js           # 服务端钩子
├── styles.css         # 被 js.json 引用的样式
└── client.js          # 被 js.json 引用的客户端脚本
```

mod.json — 元数据，用来描述扩展：

```json
{
  "name": "暗色切换",
  "description": "给页面加主题切换按钮",
  "version": "1.0.0",
  "author": "Your Name",
  "enabled": true,
  "order": 100
}
```

js.json — 声明式注入，开箱即用的最小配置：

```json
{
  "styles": "styles.css",
  "scripts": "client.js"
}
```

index.js — 服务端钩子，所有钩子都已注释掉，需要时取消注释即可：

```js
module.exports = {
  onInit(ctx) {
    ctx.log('已加载');
  },
  // onFiles(files, ctx) { return files; },
  // onHtml(html, ctx) { return html; },
  // onRequest(req, url, ctx) { return null; },
};
```

styles.css / client.js — 引用的样式和脚本文件，里面有一些注释示例，改一改就能用。

同时，create 会更新 .js/js.list.json：

```json
{
  "extensions": ["darkmode"]
}
```

---

命名规则

扩展名（目录名）必须满足：

· ✅ 只包含字母、数字、-、_
· ✅ 长度 1 到 64 字符
· ❌ 不能包含 / 或 \（防止路径穿越）
· ❌ 不能以 . 开头（避免与隐藏目录混淆）
· ❌ 不能包含空格、中文等特殊字符

合法示例：darkmode、my-ext、toc_v2、abc123

非法示例：my ext（空格）、../evil（路径穿越）、.hidden（点开头）、中文名（非 ASCII）

CLI 会校验并给出明确提示。server.js 加载扩展时也会做同样的校验，两道防线保持一致。

显示名称没有限制，可以是任意 UTF-8 字符串，包括中文。

---

与 server.js 的配合

CLI 只负责管理文件，不重启服务。改动后由服务端的扩展热重载机制自动生效。

工作流

```bash
# 1. 创建扩展
node cli.js create my-ext

# 2. 编辑扩展文件（改样式、加钩子、写脚本）
vim .js/my-ext/index.js

# 3. 刷新浏览器 → 立即生效

# 4. 不用了，禁用
node cli.js disable my-ext

# 5. 刷新浏览器 → 效果消失

# 6. 彻底删除
node cli.js remove my-ext -y
```

每一步操作后，服务端终端会打印：

```
♻  [14:32:07] 扩展已重新加载：1 个 → my-ext
```

热重载边界

会自动重载：

· ✅ 修改 .js/<name>/ 下任意文件
· ✅ 新增、删除扩展目录
· ✅ 修改 js.list.json

需重启：

· ⚠️ 修改 server.json 里的 extensions.dir（换了扩展目录名）
· ⚠️ 修改 server.json 里的 extensions.enabled（从 true 改 false 或反过来，建议重启）

版本核对

如果 CLI 创建了扩展但页面没反应，可以用 JSON API 核对：

```bash
curl -s http://localhost:3000/?format=json | grep -A5 extensions
```

看返回的 extensions 数组是否包含新扩展。

---

常见问题

Q：node cli.js create 提示"扩展已存在"怎么办？

用 -f 强制覆盖：

```bash
node cli.js create darkmode -f
```

或者换个名字。-f 会重写所有模板文件，注意备份你自己改过的内容。

Q：为什么 list 里某个扩展显示"目录缺失"？

js.list.json 里写了一个扩展名，但 .js/ 下找不到对应目录。可能是手工删过目录但忘了改清单。修复方法：

```bash
# 要么从清单移除
node cli.js remove broken -y

# 要么补回目录
node cli.js create broken -y
```

Q：cli.js 和 server.js 必须放一起吗？

不必须，但强烈建议放一起。原因：

· 扩展管理命令可以用 --root 指定任意位置，不依赖两者同目录
· 但构建命令（build / pack / sfx / start / dev）始终在 cli.js 所在目录找 build.js

从任意位置调用扩展管理时用 -r：

```bash
node /path/to/cli.js list -r /path/to/project
```

如果两个文件放一起，并且在项目根目录执行，直接 node cli.js build 就好。

Q：能批量创建多个扩展吗？

CLI 本身不带批量功能，但可以用 shell 循环：

```bash
for name in toc darkmode search; do
  node cli.js create "$name" -y
done
```

Q：创建后的扩展为什么页面没反应？

按顺序检查：

1. .js/<name>/mod.json 里 enabled 是不是 false
2. .js/js.list.json 里是否包含扩展名（create 会自动追加）
3. 服务端是否启用了扩展系统（server.json 的 extensions.enabled）
4. 终端是否打印了 ♻ 扩展已重新加载 的日志
5. 用 /?format=json 看 extensions 数组

Q：remove 会顺便删除 js.list.json 里的项吗？

会。remove 同时处理目录和清单项，两者都清理。只想从清单移除但保留目录，用 disable；只想从清单移除但保留文件，可以手工编辑 js.list.json。

Q：-y 和 -f 有什么不同？

· -y（--yes）跳过确认询问，用默认值代替
· -f（--force）允许覆盖已存在的文件或目录

两者是独立维度，可以一起用：

```bash
node cli.js create darkmode -y -f    # 静默覆盖
node cli.js remove darkmode -y       # 静默删除
```

Q：start 和 dev 有什么不同？

维度 start dev
运行的文件 server.dist.js（先构建） server.js（源码）
客户端库来源 内联常量 读 .navext.client.js 文件
改客户端库是否生效 要重新构建 刷新即生效（mtime 缓存）
适用场景 测试发布态 日常开发

start 每次都会跑一遍 build，几秒钟的开销。开发时用 dev 更快。

Q：怎么把参数传给 server？

用 -- 分隔符：

```bash
node cli.js start -- --port 8080
node cli.js dev -- --port 8080 --root ./public
```

-- 之后的参数原样传给 server.dist.js 或 server.js。

Q：pack / sfx 打包时带了什么？

完整清单见 README 的"打包与分发"章节。简要说：

· 包含：所有 HTML / CSS / JS / 图片 / 字体 / 媒体 / .js/ 扩展 / 配置文件
· 排除：server.js / build.js / cli.js / .navext.client.js（这些已内联）/ node_modules / .git / 备份文件

想预览打包内容：

```bash
node build.js --pack --list
```

Q：能不能把它当 API 使用？

cli.js 是纯命令行工具，没有导出模块。如果需要在脚本里调用，直接走 child_process：

```js
const { execSync } = require('child_process');
execSync('node cli.js create my-ext -y', { cwd: process.cwd() });
```

或者直接操作文件——所有逻辑都在 server.js 的扩展加载器里，cli.js 只做文件读写。

Q：终端中文对齐有点歪？

CLI 内部用 displayWidth() 计算列宽，中文按 2 格算。如果你用的字体宽度异常（比如中文按 1.5 格渲染），对齐可能略有偏差。用支持等宽字体的终端（iTerm2、Windows Terminal、VS Code 内置终端、Termux）通常都没问题。

---

相关文件

文件 说明
cli.js 本工具，扩展管理 + 构建入口
build.js 构建脚本，合并 + 打包
server.js 服务器源文件
.navext.client.js 客户端库（开发态从它读）
server.dist.js 合并产物（build 生成）
app.tar.gz tar.gz 打包产物（pack 生成）
app.sh 自解压单文件（sfx 生成）
server.json 全局配置
html.json 文件元数据
.js/js.list.json 扩展清单
.js/config.json 用户扩展配置（运行时生成）
.js/<name>/mod.json 扩展元数据
.js/<name>/js.json 扩展注入配置
.js/<name>/index.js 扩展服务端逻辑

---

License

MIT
