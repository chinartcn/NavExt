# NavExt 收尾清单 — 已完成 / 待办 / 怎么做

> 生成时间：2026-10-06
> 当前版本：**v2.8.1**
> 范围：v2.7.0 → v2.8.1 的已落地事项，以及审计后确认尚未处理的 3 条
> 方法：逐条实测验证，不做"看起来对"的推断（见文末「已排除项」）

---

## 一、已完成（v2.7.0 → v2.8.1）

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

---

## 二、待办（审计后确认仍未处理）

> 三条均经**实测复现**确认，非推断。

### 🟡 T1：`ctx.project` 与 `ctx.fs` 语义不一致（三处）

**实测结论**：两套 API 明明是同族，行为却不同，扩展作者容易踩坑。

| 维度 | `ctx.fs`（扩展目录，读写） | `ctx.project`（站点目录，只读） | 冲突 |
| --- | --- | --- | --- |
| **超限行为** | 无限制，多大都读 | 超限抛 `PROJECT_FS_TOO_LARGE` | 一个有守卫一个没有 |
| **上限值** | 无 | 默认 4 MB（`extensions.projectMaxBytes`） | 同上 |
| **`list` 返回** | `{ name, type }` | `{ name, path, type }` | 结构不同，字段不兼容 |
| **`list` 递归** | 不支持 | `opts.depth` 支持 | 能力不对等 |

**怎么做**（按推荐度排序）：

- **方案 A（推荐，小改）**：给 `ctx.fs` 补齐对齐——
  1. `ctx.fs.read` 加 `maxBytes` 守卫（默认取 `api.fs.maxReadSize`），超限抛同样的 `code: 'FS_TOO_LARGE'`；
  2. `ctx.fs.list` 返回补 `path` 字段，并支持 `opts.depth`；
  3. 两处 `maxBytes` 默认值统一从配置读取，文档写清默认值。
  - 兼容性：**纯新增**（`path` 字段和 `depth` 都是加出来的，老代码 `{name, type}` 解构不受影响；`maxBytes` 守卫只在上限处生效，默认值够大不会误伤）。
- **方案 B（统一抽象）**：抽一个 `makeFs(baseDir, { writable, maxBytes, hideDot })` 工厂，`ctx.fs` 与 `ctx.project` 都由它产出，差异只在参数。
  - 好处：**根除这类不一致**，以后加第三个 FS 不会再跑偏。
  - 代价：改动面大，`ctx.fs` 的 `write` / `delete` 与 `ctx.project` 的只读语义要在工厂里用开关区分。

**建议**：先做 A（半小时），把 B 记进 backlog。

---

### 🟡 T2：`match.env` 缺 `value` 时静默不命中

**实测结论**：`server.json` 写

```json
{ "match": { "env": "NODE_ENV" }, "file": "dev.html" }
```

（漏了 `value`）—— **永远不匹配，且启动日志无任何提示**。排查「为什么这个主页没生效」时会很痛苦。

**根因**（`routeMatches`）：

```js
if (m.env) {
  const val = process.env[m.env];
  if (val === undefined || String(val) !== m.value) return false;
  //                                   ^^^^^^^^^^^ m.value 是 undefined
}
```

`String(val) !== undefined` 恒为真 → 恒不匹配。

**怎么做**（两步，都很小）：

1. **启动校验告警**：在 `buildConfig` 后的校验阶段，遍历 `home.routes[]`，发现 `match.env` 存在但 `match.value` 为空 → 推入 `cfgWarnings`，复用现有的启动提示机制：
   ```
   · ⚠️ home.routes[2].match.env = "NODE_ENV" 但缺少 value，该路由永远不会命中
   ```
   （现有 `cfgWarnings` 已有类似输出，见启动横幅 `· ⚠️ home.routes[].match.env —— 启动时读取一次`）
2. **语义收紧（可选）**：若只写 `env` 不写 `value`，可定义为"该环境变量存在即匹配"（`val !== undefined`）。但这会让语义变复杂，**建议不做**，只加告警。

**建议**：只做第 1 步。成本极低，收益是"配置错误不再静默"。

---

### 🟡 T3：`order` 决定 CSS 覆盖顺序，但文档没点明

**实测结论**：机制本身**正确**，文档也讲了排序规则（`NavExt.md` 2063-2067 行：`requires` 优先级更高，被依赖者总在前）。**缺的是"这会决定 CSS 谁覆盖谁"这个后果没写**。

具体坑：扩展 A（`order: 1`）依赖 B（`order: 100`），拓扑排序会把 B 提前到 A 之前 → **B 的 CSS 晚注入 → B 覆盖 A**，与"order 小的优先"的直觉相反。

**怎么做**（纯文档，无代码改动）：

1. 在 `mod.json` 的 `order` 字段说明处补一句后果：
   > `order` 同时决定**注入顺序** —— 越晚注入的 `styles.css` 覆盖优先级越高。
   > 注意 `requires` 会让被依赖者前置，可能改变实际覆盖关系。
2. 在「扩展作用域」或「CSS 注入」相关章节加一个**具体示例**：
   ```
   A (order=1, requires=[B])  →  实际注入顺序：B → A  →  A 的样式覆盖 B
   ```
3. 需要精细控制覆盖时，建议用**更高的 CSS 特异性**（`.card.nx-featured`）而不是依赖加载顺序。

**同步位置**：`NavExt.md` + `MD/03-扩展系统.md`（拆分版需同步）。

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

## 四、建议的推进顺序

| 顺序 | 事项 | 工作量 | 价值 |
| --- | --- | --- | --- |
| 1 | **T3 文档补强**（order 与 CSS 覆盖） | 15 分钟 | 消除一个真实误解源 |
| 2 | **T2 启动校验告警**（match.env 缺 value） | 20 分钟 | 配置错误不再静默 |
| 3 | **T1 方案 A**（ctx.fs 对齐 ctx.project） | 30 分钟 | 消除同族 API 的行为分裂 |
| 4 | T1 方案 B（统一 FS 工厂） | 2 小时 | 根治不一致，但非紧迫 |

三项都是**纯新增 / 纯文档**，不破坏现有扩展，可合并为一次 v2.8.2 发布。

---

## 五、其他建议

1. **token 安全**：当前使用的 PAT 含 `repo` + `admin:org` + `delete_repo` 等宽权限，且在对话中明文传递过。建议改用 **Fine-grained PAT**，只授权 `chinartcn/NavExt` 单仓库的 `Contents: Read and write`，然后吊销旧的。
2. **文档站上线**：`rtcnnavext.de5.net` 的 NS 验证应已完成，可将 `MD/` 挂上去（NavExt 本身就能服务静态文件）作为在线文档。
3. **生态分发**：扩展能力面已无结构性缺口，下一步投入产出比更高的是**扩展的安装 / 更新 / 卸载**（`navext install <zip|url>`），配合已有的 `build.js --pack` 形成闭环。

---

*本文档由 NavExt 审计流程生成，所有「待办」项均经实测复现；「已排除项」经反证确认。*
