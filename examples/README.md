# NavExt 扩展示例

5 个「教学型」扩展，每个聚焦一类 API。复制到站点的 `.js/` 目录即可运行：

```bash
cp -r examples/ex1-hello-hooks /path/to/your-site/.js/
```

并在站点的 `.js/js.list.json` 里登记：

```json
{ "extensions": ["ex1-hello-hooks"] }
```

> ⚠️ **扩展目录名必须以字母或下划线开头**（`/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/`）。
> 以数字开头（如 `01-foo`）会导致配置/统计 API 返回「id 不合法」。

---

## 示例一览

| 示例 | 演示什么 | 钩子 / API |
| --- | --- | --- |
| `ex1-hello-hooks` | 六个服务端钩子的用法与返回值约定 | `onInit` `onFiles` `onHtml` `onRequest` `onResponse` `stats` |
| `ex2-card-badges` | 给卡片加徽章、图标、属性、类 | `addCardBadge` `addCardIcon` `setCardAttribute` `addCardClass` |
| `ex3-markdown-render` | 拦截 `.md` 请求并渲染成 HTML；含配置 schema | `onRequest` + `js.json` 的 `config` |
| `ex4-reading-stats` | 访问埋点 → 暴露指标 → 客户端取数上色 | `onResponse` `stats` `getExtStats` |
| `ex5-search-shortcut` | 键盘快捷键 + 内置 UI 控制 | `ui.setView/setTheme/setAccent` |

---

## 逐个说明

### ex1-hello-hooks — 钩子全览

最短的"扩展是什么"入门。它不干实事，只把每个钩子触发时打日志，
并演示三种返回值约定：

- `onFiles` 返回**数组** → 替换文件列表（**必须同步**）
- `onHtml` 返回**字符串** → 替换 HTML
- `onRequest` 返回**对象** → 短路并直接作为响应（`{status, headers, body, type}`）
- `onResponse` / `onInit` 返回值**被忽略**（前者是只读观察者）

试一下：访问 `/hello-hooks/status` 看虚拟接口。

### ex2-card-badges — 卡片标记

演示客户端如何"装饰"卡片。关键点是**幂等**：卡片在视图切换、搜索后都会重渲染，
所以装饰函数要能安全地重复执行（`addCardBadge` 用 `key` 去重）。

```js
NavExt.on('cards-rendered', decorate);   // 卡片渲染完
NavExt.on('view-changed', decorate);     // 视图切换后
```

### ex3-markdown-render — Markdown 渲染

演示"扩展自己的 HTTP 端点"：拦截 `*.md`，读文件、转 HTML、返回。
顺带演示了**配置 schema**（`js.json` 的 `config`）—— 用户可在
扩展管理面板里改标题颜色和体积上限。

> 读站点文件用 `ctx.project`（v2.8.0 新增）：只读、限定在站点 `root` 内，
> 越界 / 隐藏路径 / 软链接三重校验由内核完成，扩展不必自己拼 `path.resolve`。
> 本示例已从原生 `fs` 迁移到 `ctx.project`。

### ex4-reading-stats — 阅读时长与热度

完整的"埋点 → 指标 → 消费"闭环：

```
onResponse  →  累加统计
     ↓
stats()     →  GET /api/extensions/ex4-reading-stats/stats
     ↓
client.js   →  NavExt.getExtStats() → 给卡片加「👁 N」「热门」徽章
```

**路径归一化（v2.7.0 起用官方 API）**：`onResponse` 的 `pathname` 是 `/docs/a.html`（带斜杠），
而 `getFiles()[].path` 是 `docs/a.html`（不带斜杠）。做关联时直接用：

```js
NavExt.normalizePath('/docs/a.html')  // → 'docs/a.html'
NavExt.normalizePath('docs/a.html')   // → 'docs/a.html'（同一 key）
```

**生命周期管理（v2.7.0 起）**：旧版示例裸用 `setInterval`，扩展禁用后定时器仍会
继续跑。新版改用 `disposer` 托管：

```js
var timer = setInterval(refresh, 30000);
NavExt.disposer(EXT_ID, function () { clearInterval(timer); });
// 页面卸载 / 手动 NavExt.dispose(EXT_ID) 时自动清理
```

这解决了「扩展禁用后泄漏」的问题——在真实浏览器中实测：`dispose` 后 tick 立刻停止增长。

### ex5-search-shortcut — 快捷键与视图

演示 v2.6 的 `ui` API 与键盘协作：

| 按键 | 行为 | 用到的 API |
| --- | --- | --- |
| `/` | 聚焦搜索框 | DOM |
| `t` | 循环切换 系统/浅色/深色 | `ui.setTheme` |
| `v` | 切换 按目录/按时间 | `ui.setView` |
| `c` | 循环切换主题色 | `ui.setAccent` |
| `Esc` | 清空搜索 | DOM |

在输入框里打字时不会劫持按键（避免影响正常输入）。

---

## 安全审计

所有示例都可用 `vm.js` 审计：

```bash
node vm.js --all examples
# ✅ Benign 85 分 × 5，0 恶意 0 可疑
```

---

## 想加自己的扩展？

```bash
node cli.js create my-ext      # 交互式生成骨架
```

然后参考本例的写法。完整的 API 参考见 [`../NavExt.md`](../NavExt.md)，
能力缺口见 [`../../../NavExt-扩展能力缺口清单.md`](../../../NavExt-扩展能力缺口清单.md)。
