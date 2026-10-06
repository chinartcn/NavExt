# NavExt 收尾清单 — 已完成 / 待办 / 怎么做

> 更新时间：2026-10-06
> 当前版本：**v2.8.3**
> 范围：v2.7.0 → v2.8.3 的已落地事项
> 方法：逐条实测验证，不做"看起来对"的推断（见文末「已排除项」）
>
> **✅ 原第二节的三条待办（T1 / T2 / T3）已在 v2.8.2 全部处理完毕**，详见下方「v2.8.2」小节。
> **✅ v2.8.3 把导航页降级为可选扩展（`.js/navext-ui/`），并新增 `install.js` 安装脚本。**

---

## 一、已完成（v2.7.0 → v2.8.3）

### v2.7.0 — 扩展生命周期 + 路径归一化

| # | 能力 | 内容 |
| --- | --- | --- |
| 1 | **客户端生命周期** | `NavExt.disposer(extId, fn)` / `dispose(extId)` / `isDisposed(extId)`；`pagehide` + `beforeunload` 自动全局清理；bfcache 恢复重派 `init` |
| 2 | **服务端 `onDispose`** | 扩展被禁用 / 重载 / 服务退出时调用，让扩展有机会收尾 |
| 3 | **路径归一化** | 服务端 `ctx.pathOf/urlToRel/relToUrl`；客户端 `NavExt.pathOf/urlToRel/relToUrl/normalizePath`；两实现行为逐条比对一致 |
| 4 | **5 个教学示例** | ex1 钩子全览 / ex2 卡片标记 / ex3 Markdown 渲染 / ex4 阅读统计 / ex5 快捷键 |

### v2.7.1 — 文档拆分

| # | 能力 | 内容 |
| --- | --- | --- |
| 5 | **`MD/` 主题拆分** | 10 篇主题文档 + 导航首页 + 《从零写第一个扩展》12 节手把手教程 |
| 6 | **`NavExt.md` 保留全文** | 顶部加 MD/ 索引，正文不动，旧锚点不失效；71 条本地链接 0 失效 |

### v2.8.0 — `ctx.project` 站点只读 API

| # | 能力 | 内容 |
| --- | --- | --- |
| 7 | **`ctx.project`** | `read` / `list` / `stat` / `exists` / `path`，只读、限定站点 `root` |
| 8 | **三重校验** | 越界 + 隐藏路径 + 软链接，与静态资源服务（`resolveStaticPath`）同源 |
| 9 | **修复 `urlToRel` 扩展名误判** | 原用 `hasHtmlExt` 判断是否文件 → `/docs/a.md` 被补成 `docs/a.md/index.html`；改为 `hasFileExt`，服务端与客户端同步 |
| 10 | **ex3 迁移** | 删掉 `require('fs')` + 手写越界检查，改用 `ctx.project` |

### v2.8.1 — 安全默认值 + 生命周期补全 + 搜索分页

| # | 能力 | 内容 |
| --- | --- | --- |
| 11 | **`api.fs.write` 默认改 `false`** | 切断「HTTP 写扩展文件 → 热重载 → 执行任意代码」无鉴权链路 |
| 12 | **SIGTERM handler** | 此前 `docker stop` / `systemd` / `k8s` 驱逐无处理；现 SIGINT / SIGTERM 统一走 `shutdown()`，退出前逆序 `disposeExt()` |
| 13 | **`apiConfigPayload` 去 `force`** | 2000 文件场景 330ms → 0.7ms；20 并发 p50 8.5s → 325ms |
| 14 | **`/api/search` 分页** | 新增 `offset` 参数与 `hasMore` 字段，解决第 501 条之后静默丢失 |
| 15 | **scope 补齐到全部 JSON 出口** | `/api/extensions`、`/api/extensions/:id`、`/?format=json` 三处补 `scope` 字段 |
| 16 | **文档补强** | config schema 完整示例、`ctx.timer` vs `ctx.interval`、`ctx.fetch` 超时、`/api/search` 完整文档、安全边界链路说明 |

### v2.8.2 — 注入顺序解耦 + ctx.fs 对齐 + 配置告警

| # | 能力 | 内容 |
| --- | --- | --- |
| 17 | **`cssOrder`（T3 的解）** | 新增 `mod.json.cssOrder`：CSS 覆盖顺序**独立于**加载顺序。`styles` 按 `cssOrder` 升序注入，其余注入仍按加载顺序；未声明时回退 `order`，旧行为完全不变 |
| 18 | **`ctx.fs` 对齐 `ctx.project`（T1）** | `read(rel, { encoding, maxBytes })` 超限抛 `FS_TOO_LARGE`；`list` 返回值补 `path` 字段、支持 `{ depth }` 递归 |
| 19 | **修复 `ctx.fs.list` 静默吞错** | 目标目录不存在时原本返回 `[]`（`walk` 内的 `try/catch` 吞掉了入口 ENOENT），现改为抛「目录不存在」；目标是文件时抛「不是目录」，与 `ctx.project.list` 一致 |
| 20 | **`match.env` 启动告警（T2）** | 配了 `match.env` 却没配 `match.value` 的路由永远不命中，此前静默；现在启动时输出 `⚠ server.json 配置被修正：home.routes[N].match.env = XXX —— 配了 env 却没有 value，该路由永远不会命中` |
| 21 | **`js.json` 文件引用提示（文档）** | `.css` / `./x.css` 会命中「内联内容」分支而**不是**读文件；文档明确推荐 `"@file:client.css"` |
| 22 | **文档同步** | `NavExt.md` + `MD/03-扩展系统.md` 同步补 `cssOrder` 语义、注入顺序表、`ctx.fs` 新签名与错误码、版本历史 |

### v2.8.3 — 导航页降级为可选扩展 + 安装脚本

| # | 能力 | 内容 |
| --- | --- | --- |
| 23 | **新增 `onNavPage(ctx)` 钩子** | 内核渲染展示页时调用；扩展返回 `{ html }` 即作为 `<body>` 内容，返回 `null` 则让位下一个扩展。判定「有没有展示页」靠 `hasNavPageProvider()`（不硬编码扩展 id），按 scope / 页面策略过滤后探测 |
| 24 | **新增 `ctx.nav` 只读快照** | `{ root, pathname, files, dirs, site, stats }`；`files[].path` 与 `?format=json` 输出命名一致。解决「扩展拿不到扫描结果」的根本问题 |
| 25 | **展示页搬迁为扩展 `.js/navext-ui/`** | `index.js`（onNavPage 实现）+ `client.js`（搜索/快捷键）+ `styles.css`（展示页样式）+ `mod.json`（`order`/`cssOrder` = 10）+ `js.json`（`@file:` 引用）。内核删除 `renderCard`/`renderSection`/`groupFilesByDir`/`sortDirKeys`/`CORE_SEARCH_SCRIPT` 与 `BASE_STYLE` 的展示页样式，共约 260 行 |
| 26 | **内核只保留主题变量** | 亮/暗两套基础色与 `--brand` / `--brand-ring` 留在 `BASE_STYLE()`。原因：其他扩展（面板、徽章）依赖这套变量配色，随展示页搬走会让它们集体失效 |
| 27 | **三层回退（`renderNavFallback`）** | 无展示页扩展时：① 服务 `root/index.html`（照常注入扩展、过 `onHtml`）② 没有则 **HTTP 200 + 0 字节**。其他扩展在任何情况下都照常加载 |
| 28 | **API 同步降级** | `GET /?format=json` 与 `GET /api/search` 在无展示页扩展时返回 404 + 明确原因（它们输出的正是展示页的数据源） |
| 29 | **`build.js` 打包开关** | `--no-ui-ext` / `--with-ui-ext`（默认带）。排除时同步 `pruneUiExtFromList()` 从 `.js/js.list.json` 剔除条目（支持四种清单形态），并把源文件收进 `.js-install/navext-ui/` 作为安装载荷（内核不扫描该目录） |
| 30 | **新增 `install.js`（零依赖）** | 先探测（目录 + 清单双向）再询问，默认「是」；支持 `--yes` / `--no` / `--dry-run` / `--force` / `--root`；非交互环境默认安装；自动识别并修复「目录与清单不一致」的半装状态；源文件依次在 `.js-install/` 与 `.js/` 两处查找 |
| 31 | **`cli.js install` 子命令** | 透传到 `install.js`。修正 `parseArgs` 吞掉未知选项的问题：新增 `rawArgsAfter()`，从原始 argv 切片转发（`--dry-run` 等不再丢失） |
| 32 | **启动横幅展示页状态** | 已装 → `展示页 navext-ui`；未装 → `展示页 ✖ 未安装（无扩展实现 onNavPage）` + 下一步行为（服务 index.html / 返回空页面）+ 安装命令 |
| 33 | **`err.sh` 适配 v2.8.3** | 身份探针依赖 `/?format=json`（现由展示页扩展提供）。沙箱预装 `.js/navext-ui/`，`reset_js` 与 `set_list` 均保证目录与清单同时含 `navext-ui`，否则 identity 校验会全部误判为「端口被占」 |
| 34 | **A/B 结构对比** | 用 v2.8.2 与 v2.8.3 在相同站点内容下渲染，提取 `<body>` 到 `nav-data` 之间的核心区做 difflib 对比 —— **101 行 vs 101 行，剔除环境差异后结构完全一致** |
| 35 | **回归验证** | `err.sh` 20/20、`pathtest.js` 31/31、`lifetest.js` 22/22、`parity.js` 15 组×2 方向；`ctx.fs` / `ctx.project` 对称性复测通过（`FS_TOO_LARGE` / `PROJECT_FS_TOO_LARGE`、越界与 dotfile 均被拦截） |
| 36 | **文档同步** | `NavExt.md`、`MD/03-扩展系统.md`（新增 `onNavPage` 专节 + `ctx.nav`）、`MD/06-主页与路由.md`（三层回退 + 安装/卸载）、`MD/07-打包与分发.md`（`--no-ui-ext` 开关 + `.js-install/`） |

#### T1 / T2 / T3 的验证记录

| 项 | 验证方式 | 结果 |
| --- | --- | --- |
| **cssOrder 解耦** | 场景：A(`order=500, cssOrder=1`)、B(`order=10, cssOrder=999`) | 加载顺序 `B → A`，CSS 注入顺序 `A → B`（**完全相反**），最终 B 样式生效 ✅ |
| **cssOrder 向后兼容** | 两扩展都不写 `cssOrder`，`order` 分别为 1 / 100 | 加载与 CSS 顺序均为 `1 → 100`，与旧版一致 ✅ |
| **scripts 不受 cssOrder 影响** | 同上场景 | `scripts` 按加载顺序注入 ✅ |
| **ctx.fs 对齐** | 24 条断言（`/fsprobe`） | **24/24 通过**，含旧写法兼容、`maxBytes` 超限、`depth` 递归、与 `ctx.project` 对称性 ✅ |
| **match.env 告警** | `server.json` 写 `{ "match": { "env": "NAVEXT_DEV" } }` | 启动即告警 ✅ |

---

## 二、待办

**当前无阻塞性待办。** 原 T1 / T2 / T3 均已闭环（见上）。

### 可选的后继项（非紧迫）

| 项 | 说明 | 工作量 | 价值 |
| --- | --- | --- | --- |
| **统一 FS 工厂** | 抽 `makeFs(baseDir, { writable, maxBytes, hideDot })`，`ctx.fs` / `ctx.project` 都由它产出，根治同族 API 分裂（当前是「两处手动对齐」，靠纪律维持） | ~2h | 中 |
| **`navext install <zip\|url>`** | 扩展的安装 / 更新 / 卸载，配合已有 `build.js --pack` 形成分发闭环 | ~1d | 高 |
| **token 收敛** | 换 Fine-grained PAT，只授 `chinartcn/NavExt` 的 `Contents: Read and write`，吊销旧 PAT（旧 token 权限过宽且在对话中明文出现过） | 10 分钟 | 高（安全） |
| **文档站上线** | `rtcnnavext.de5.net` NS 验证完成后，把 `MD/` 挂上去（NavExt 本身就能服务静态文件） | ~1h | 中 |

---

## 三、已排除项（审计过但确认不是问题）

### ❌ 「`html.json` 子目录元数据疑似失效」——不成立

**实测**（站点 `docs/` 下放 `html.json`，含 `@dir` + 文件级 title/description + glob 键）：

| 场景 | 结果 |
| --- | --- |
| 子目录 `@dir` 的 `title` / `description` | ✅ 正确出现在 `dirs[]` |
| 子目录文件级 `title` / `description` | ✅ 正确生效 |
| 子目录 glob 键（`"*.html"`） | ✅ 正确匹配 |
| 子目录文件级 `hidden: true` | ✅ 正确隐藏 |

**根因分析**：`scanHtml` 递归时对**每个目录**都调用 `loadDirMeta(dir, ...)`，子目录元数据完全生效。

**可能造成误判的地方**（记录下来避免重复排查）：

1. 只设 `@dir: { hidden: true }` 而**不设** `title` / `description` 时，该目录**不会**出现在 `dirs[]` 里 —— 因为代码是 `if (dirTitle || dirDescription)` 才写入。这是**有意设计**（没标题就不必占位），不是 bug。
2. `/?format=json` **默认不含 hidden 项**，`count` 只算可见的，被隐藏的文件会"消失"。要看到全部需加 `?hidden=1`。容易误判成"元数据没生效"。

---

## 四、其他建议

1. **token 安全**：当前使用的 PAT 含 `repo` + `admin:org` + `delete_repo` 等宽权限，且在对话中明文传递过。建议改用 **Fine-grained PAT**，只授权 `chinartcn/NavExt` 单仓库的 `Contents: Read and write`，然后吊销旧的。
2. **文档站上线**：`rtcnnavext.de5.net` 的 NS 验证应已完成，可将 `MD/` 挂上去（NavExt 本身就能服务静态文件）作为在线文档。
3. **生态分发**：扩展能力面已无结构性缺口，下一步投入产出比更高的是**扩展的安装 / 更新 / 卸载**（`navext install <zip|url>`），配合已有的 `build.js --pack` 形成闭环。

---

*本文档由 NavExt 审计流程生成，所有结论均经实测复现；「已排除项」经反证确认。*
