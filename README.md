# NavExt

一个零依赖的 Node.js 静态服务器，扫描目录下的 HTML 文件生成带搜索的导航页。

支持 **JS 扩展**、**配置热重载**、**多主页路由**、**单文件打包分发**——所有功能只用 Node.js 内置模块，无需 `npm install`。

**完整文档见 [NavExt.md](./NavExt.md)**

---

## 特性

| 特性 | 说明 |
| --- | --- |
| 🗂 **自动扫描** | 递归扫描目录，按目录分组展示所有 HTML |
| 🔍 **实时搜索** | 按名称/介绍/路径搜索，`/` 聚焦、`Esc` 清空 |
| 🎨 **外观定制** | 标题、描述、logo、页脚、主题色全部可配 |
| 📝 **文件描述** | `html.json` 为任意 HTML 添加标题和介绍 |
| 🧩 **JS 扩展** | 插件系统，可注入样式/脚本、拦截请求、读写文件 |
| 🎛 **扩展配置** | 扩展声明配置 schema，用户在浏览器里改，无需动代码 |
| 🎯 **扩展作用域** | `js.list.json` 按路径精细控制扩展生效范围 |
| 🔗 **扩展依赖** | `requires` 声明依赖，服务端拓扑排序，缺依赖自动跳过 |
| 📊 **扩展统计** | `stats()` 暴露运行时数据，`GET /api/extensions/:id/stats` 读取 |
| 🌐 **ctx.fetch** | 扩展内网络请求，超时 + 重载自动 abort |
| ⏱ **ctx.timer / interval** | 扩展内定时器，重载/禁用/关停自动清理。`timer` 一次性，`interval` 重复 |
| ⏱ **钩子超时** | `extensions.timeout` 保护异步钩子，超时返回 504 |
| 🪝 **onError 钩子** | 扩展可监听自身错误，`ctx.hook` 标明来源 |
| 🌐 **多主页路由** | `home.routes` 按路径 / Host / 环境变量切换不同主页 |
| ♻️ **全量热重载** | 配置、元数据、扩展、HTML、客户端库，改完全部即时生效 |
| 📦 **单文件分发** | 打包成 `app.sh`，客户端库、HTML、扩展全内联 |
| 📡 **API 齐全** | RESTful 服务端 API + `window.NavExt` 客户端 API |
| 🌗 **自动暗色** | 跟随系统 `prefers-color-scheme` |
| 🛡 **路径安全** | 防目录穿越、防 CSS 注入、无软链死循环 |

---

## 快速开始

**环境要求**：Node.js 14 或更高版本（`ctx.fetch` 需要 Node 18+）。

### 1. 开发态

两个文件放在一起：

```

my-project/
├── server.js             ← 服务器
└── .navext.client.js     ← 客户端库

```

```bash
node server.js
# 打开 http://localhost:3000
```

改 .navext.client.js 后刷新页面即生效（mtime 缓存，无需重启）。

### 2. 建一个扩展

```bash
node cli.js create my-ext
# 交互式提问：显示名称、描述、作者
# 完成后生成 .js/my-ext/，自动加入 js.list.json
```

生成的模板：

```
.js/my-ext/
├── mod.json           # 元数据
├── js.json            # 注入配置 + 配置 schema
├── index.js           # 服务端钩子
├── client.js          # 客户端脚本
└── styles.css         # 样式
```

编辑 client.js 加逻辑，刷新页面即生效：

```js
NavExt.on('cards-updated', function () {
  NavExt.addCardBadge('index.html', 'NEW', '#10b981');
});
```

### 3. 打包分发

```bash
node build.js --pack --sfx
# 生成 app.sh（单个文件）
```

用户侧：

```bash
chmod +x app.sh
./app.sh                  # 解压到临时目录并启动
./app.sh --keep ./myapp   # 解压到指定目录，保留文件
```

---

## 配置文件

### server.json — 全局配置

```json
{
  "port": 3000,
  "host": "0.0.0.0",

  "site": {
    "title": "项目文档中心",
    "description": "所有页面的统一入口",
    "logo": "📚",
    "footer": "© 2024 My Company",
    "accent": "#4f6ef7",
    "showStats": true
  },

  "home": {
    "enabled": true,
    "file": "home.html",
    "applyExtensions": true,
    "routes": [
      { "match": { "path": "/docs" }, "file": "docs.html" }
    ]
  },

  "ignoreDirs": ["node_modules", ".git"],
  "htmlExtensions": [".html", ".htm"]
}
```

改完刷新页面即生效，无需重启。port / host 除外。

### html.json — 文件元数据

放在任意目录，给 HTML 加显示名和介绍：

```json
{
  "@dir": { "title": "项目文档", "description": "全部页面的入口" },
  "index.html": { "title": "首页", "description": "项目总览" },
  "demo.html": "演示页面"
}
```

不配置的 HTML 依然会列出，显示文件名。

### .js/js.list.json — 扩展清单

```json
{
  "extensions": [
    "darkmode",
    { "id": "arch-diagram", "paths": ["/docs/*"] }
  ]
}
```

支持对象形式给扩展加作用域——只在特定路径生效。

---

## 常用命令

所有命令由 cli.js 提供：

```bash
# 扩展管理
node cli.js create <name>       创建扩展（交互式）
node cli.js list                列出所有扩展
node cli.js info <name>         查看扩展详情
node cli.js enable <name>       启用
node cli.js disable <name>      禁用
node cli.js remove <name>       删除

# 配置
node cli.js config              交互式编辑 server.json
node cli.js config --show       只显示当前配置

# 构建与运行
node cli.js dev                 直接运行源码（开发态）
node cli.js start               构建 + 启动 dist
node cli.js build               生成 server.dist.js
node cli.js pack                打包 app.tar.gz
node cli.js sfx                 打包自解压 app.sh

node cli.js help                完整帮助
```

cli.js 之外的两个独立脚本：

```bash
node server.js                  直接启动源码
node build.js --pack --sfx      打包成单个 app.sh
```

---

## 目录结构

```
my-project/
├── server.js              服务器
├── .navext.client.js      客户端库
├── build.js               打包脚本
├── cli.js                 命令行工具
├── server.json            全局配置（可选）
├── html.json              根目录元数据（可选）
│
├── index.html             示例页面
├── home.html              自定义主页（可选）
├── docs/
│   ├── html.json          子目录元数据
│   └── guide.html
│
└── .js/                   扩展目录
    ├── js.list.json       扩展清单
    ├── config.json        用户配置（运行时生成）
    └── my-ext/
        ├── mod.json
        ├── js.json
        ├── index.js
        ├── client.js
        └── styles.css
```

---

## 服务端 API

/api/* 下提供 RESTful 接口：

| 端点 | 说明 |
| --- | --- |
| `GET /api/config` | 当前配置 + 目录元数据 |
| `GET /api/extensions` | 所有扩展及状态 |
| `POST /api/extensions/toggle` | 切换扩展启用状态 |
| `GET` / `POST` / `DELETE /api/extensions/:id/config` | 读 / 改 / 重置扩展配置 |
| `GET /api/fs/list?path=<rel>` | 列出项目目录 |
| `GET /api/fs/read?path=<rel>` | 读取项目文件 |
| `POST /api/extensions/:id/fs/write` | 写入扩展文件 |

访问开关在 server.json 的 api 字段，全部支持热重载。

> ⚠️ **`api.fs.write` 默认为 `false`**，上表中的 `fs/write`、`fs/mkdir`、
> `fs/rename`、`fs/delete` 默认返回 403。写入扩展目录的内容会被热重载并执行，
> 而接口无鉴权，因此默认关闭。需要时显式打开：
>
> ```json
> { "api": { "fs": { "write": true } } }
> ```
>
> 开启前请只绑 `127.0.0.1` 或前置带鉴权的反向代理。
> `api.writable` 默认仍为 `true`——它管的是「改扩展配置」和「toggle 启停」，
> 写的是纯数据，无法注入可执行代码。

---

## 客户端 API

页面里注入 window.NavExt，提供数据、DOM、事件、样式、文件访问：

```js
// 数据
NavExt.getFiles()                       // 所有文件列表
NavExt.getConfig()                      // 站点配置
NavExt.getExtensions()                  // 所有扩展

// 扩展作用域
NavExt.isExtActive('arch-diagram')      // 当前页面是否生效
NavExt.getActiveExtIds()                // 当前页面生效的扩展 ID

// 幂等 DOM 操作
NavExt.addCardIcon('index.html', 'https://.../logo.svg')
NavExt.addCardBadge('new.html', 'NEW', '#10b981')
NavExt.addCardClass('doc.html', 'is-featured')

// 事件
NavExt.on('cards-updated', function (cards) { /* ... */ })

// 文件系统
await NavExt.fs.read('README.md')       // 项目文件（只读）
await NavExt.extFs('my-ext').write('data.json', '...')  // 扩展目录（读写）
```

---

## 文档索引

| 文档 | 内容 |
| --- | --- |
| `NavExt.md` | 完整功能说明：配置详解 / 扩展系统 / 客户端 API / 服务端 API / 打包分发 / 热重载 / 安全边界 / 常见问题 |
| `cli.md` | 命令行工具 `cli.js` 的全部命令与选项 |
---

## License

MIT
