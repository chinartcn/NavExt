# 客户端 API

> window.NavExt 全部方法、路径归一化、生命周期、DOM 操作、事件总线

[← 返回文档首页](README.md) · [← 返回主文档](../NavExt.md)

---

服务端把 __NAV_DATA__ 和 NavExt 客户端库注入到页面。所有 API 挂在 window.NavExt 上。

## 数据

| 方法 | 返回 |
| --- | --- |
| `getFiles()` | 所有文件的数组 |
| `getFile(path)` | 按路径查单个文件，找不到返回 `null` |
| `getConfig()` | 站点配置 |
| `getExtensions()` | 已启用的扩展列表 |

```js
var files = NavExt.getFiles();
// [{ path, url, dir, name, title, description, size, mtime }, ...]

var f = NavExt.getFile('docs/index.html');
var f2 = NavExt.getFile('/DOCS/INDEX.HTML');   // 路径不区分大小写
```

## 路径归一化（v2.7.0）

服务端与客户端各一份、**行为严格一致**的实现：

| 方法 | 说明 | 示例 |
| --- | --- | --- |
| `urlToRel(p)` | URL → 相对路径 | `'/docs/a.html'` → `'docs/a.html'`；`'/'` → `'index.html'` |
| `relToUrl(p)` | 相对 → URL | `'docs/a.html'` → `'/docs/a.html'`；`'index.html'` → `'/'` |
| `pathOf(p)` | 任意一侧 → 统一 URL 体系 | `'docs/a.html'` → `'/docs/a.html'` |
| `normalizePath(p)` | → 可比较的 key（小写） | `'/DOCS/A.HTML'` 与 `'docs/a.html'` 归一后相等 |

```js
// 典型场景：服务端 stats() 的键是相对路径，客户端拿它是 URL 路径
var key = NavExt.normalizePath('/docs/a.html');       // 'docs/a.html'
var n = stats.counts[key];                            // 正确命中
```

## 生命周期（v2.7.0）

扩展被禁用或页面卸载时，`setInterval` / `addEventListener` / `fetch` 轮询**不会自动停止**。
用 `disposer` 把清理函数托管给内核，即可避免泄漏：

| 方法 | 说明 |
| --- | --- |
| `disposer(extId, fn)` | 注册清理函数，返回取消注册的函数；省略 `extId` 时为全局 `'*'` |
| `dispose(extId)` | 手动执行清理（幂等，不二次执行），并移除该扩展注入的 CSS |
| `isDisposed(extId)` | 是否已清理 |

**自动清理时机**：`pagehide` / `beforeunload` 触发时，内核执行所有扩展的清理函数，
并派发 `ext-disposed`（单个扩展）与 `navext-unload`（全局）事件。bfcache 恢复（`pageshow`）时
重派 `init`，扩展可重建。

```js
var EXT_ID = 'my-ext';

var timer = setInterval(refresh, 30000);
var offCards = NavExt.on('cards-rendered', refresh);

NavExt.disposer(EXT_ID, function () {
  clearInterval(timer);
  offCards();
});

// 需要提前清理时（例如扩展自己判断已失效）：
// NavExt.dispose(EXT_ID);
```

> 服务端对称能力：`onDispose(ctx)` 钩子 + `ctx.timer` / `ctx.interval`（重载时内核自动清理）。
> 客户端此前缺的正是这个对称能力，v2.7.0 已补齐。

## 扩展配置

| 方法 | 说明 |
| --- | --- |
| `getExtMeta(id)` | 扩展完整元信息（含 config 和 schema） |
| `getExtConfig(id)` | 合并后的配置值 |
| `getExtConfigSchema(id)` | schema（用于渲染表单） |
| `getExtConfigField(id, key)` | 单个字段的值 |
| `getExtStats(id)` | 读取扩展统计（对应 stats()） |
| `setExtConfig(id, values)` | 异步写入（返回 Promise） |
| `resetExtConfig(id)` | 异步重置（返回 Promise） |

```js
var cfg = NavExt.getExtConfig('starred');
// { color: "#f59e0b", icon: "★" }

await NavExt.setExtConfig('starred', { color: '#10b981' });
await NavExt.resetExtConfig('starred');
```

## DOM 操作

所有 DOM 操作幂等——重复调用不会产生重复节点，查找不到卡片时返回 null 或 false，不抛异常。

| 方法 | 返回 |
| --- | --- |
| `getCardEl(path)` | 卡片 DOM 引用 |
| `getVisibleCards()` | 当前未被过滤掉的卡片数组 |
| `addCardIcon(path, url, opts)` | `HTMLImageElement` 或 `null` |
| `addCardBadge(path, text, color, opts)` | `HTMLSpanElement` 或 `null` |
| `addCardClass(path, cls)` | `true` / `false` |
| `removeCardClass(path, cls)` | `true` / `false` |
| `setCardAttribute(path, name, val)` | `true` / `false` |

**`addCardIcon` 的 opts**：

| 字段 | 说明 |
| --- | --- |
| `key` | 去重键，默认 `iconUrl` |
| `alt` / `title` | img 属性 |
| `size` | 边长（px） |

addCardBadge 的 opts：key 为去重键，默认 text。文字颜色按背景亮度自动选黑或白。

```js
NavExt.addCardIcon('docs/index.html', 'https://example.com/logo.png', {
  key: 'my-brand',
  size: 18,
});

NavExt.addCardBadge('docs/new.html', 'NEW', '#10b981');
```

## 事件总线

```js
// 订阅，返回取消订阅函数
var off = NavExt.on('cards-updated', function (cards) { ... });
off();

// 只触发一次
NavExt.once('init', function (payload) { ... });

// 自定义事件通信
NavExt.emit('my-ext:ready', { count: 42 });
```

**内置事件**：

| 事件 | 触发时机 | payload |
| --- | --- | --- |
| `init` | `DOMContentLoaded` 后 | `{ files, config }` |
| `cards-updated` | **推荐使用**。卡片索引变化时（初始化、搜索过滤后）| 可见卡片的 `HTMLElement[]` |
| `cards-rendered` | **已废弃**。与 `cards-updated` 同时触发，payload 相同，保留兼容 | 可见卡片的 `HTMLElement[]` |
| `ext-config-changed` | `setExtConfig` / `resetExtConfig` 成功后 | `{ id, values }` |

## 样式

```js
NavExt.injectCSS('my-ext', `
  .is-featured { border: 2px solid #4f6ef7; }
`);

NavExt.removeCSS('my-ext');
```

## 文件系统

**`NavExt.fs`** —— 项目目录，只读：

| 方法 | 返回 |
| --- | --- |
| `list(path, opts)` | `{ path, count, entries, truncated }`，`opts.all` 显示隐藏项 |
| `stat(path)` | `{ path, type, size, mtime, mime, isText, ... }` |
| `read(path, opts)` | `{ content, encoding, size, truncated, ... }`，`opts.encoding` 强制编码 |
| `exists(path)` | `boolean` |

NavExt.extFs(id) — 扩展目录，可读写：

```js
var fs = NavExt.extFs('starred');

await fs.read('starred.json');
await fs.write('starred.json', JSON.stringify(list), { mkdirp: true });
await fs.list('');
await fs.exists('cache.json');
await fs.mkdir('cache', { recursive: true });
await fs.delete('old.json');
await fs.delete('cache', { recursive: true });
await fs.rename('a.json', 'b.json');
```

所有方法返回 Promise，失败时抛出 Error，err.status 是 HTTP 状态码。

## data-ext-target 标记

页面结构元素都带 data-ext-target 属性，扩展用属性选择器精准定位，不受 DOM 结构变化影响。

| 标记 | 元素 | 附加 `data-ext-*` |
| --- | --- | --- |
| `body` | `<body>` | — |
| `header` / `header-top` | 头部 | — |
| `site-title` / `site-logo` / `site-desc` / `stats` | 头部元素 | — |
| `search` / `search-input` | 搜索框 | — |
| `main` | `<main>` | — |
| `section` | 目录分组 | `data-ext-dir` |
| `section-heading` / `section-title` / `section-path` / `section-count` / `section-desc` | 分组元素 | — |
| `grid` | 卡片容器 | — |
| `card` | 卡片 | 见下表 |
| `card-title` / `card-desc` / `card-path` / `card-meta` / `card-time` / `card-extras` | 卡片内部元素 | — |
| `noresult` / `empty` | 空态提示 | — |
| `footer` / `footer-text` / `footer-root` | 页脚 | — |
| `nav-data` / `core-script` | 脚本标签 | — |

卡片的 data-ext-* 字段：

```html
<a data-ext-target="card"
   data-ext-file="index.html"
   data-ext-path="docs/index.html"
   data-ext-dir="docs"
   data-ext-title="首页"
   data-ext-desc="项目总览与快速上手"
   data-ext-size="12345"
   data-ext-mtime="1716220800000"
   data-key="docs/index.html index.html 首页 项目总览与快速上手">
```

用法：

```js
// ✅ 精准命中
document.querySelectorAll('[data-ext-target="card"]')

// ✅ 直接读元数据，不用解析 DOM
document.querySelectorAll('[data-ext-target="card"]').forEach(function (card) {
  console.log(card.dataset.extFile, card.dataset.extPath, card.dataset.extTitle);
});
```

---

## 内置 UI 功能（v2.6）

导航页自带两个开箱即用的交互增强，**纯客户端、零依赖**，由内置客户端库提供，
无需任何扩展或配置。它们的状态都存在 `localStorage`，刷新后保持。

### 视图切换：按目录 / 按时间

搜索框下方有一组 `[按目录] [按时间]` 分段控件。

- **按目录**（默认）：保持服务端渲染的目录分组结构。
- **按时间**：把所有卡片按 `data-ext-mtime` **降序**平铺到一个网格容器中，
  并给每张卡片追加相对时间徽标（"3 天前"）。原目录分组外壳**保留在 DOM 中（仅隐藏）**，
  所以依赖 `[data-ext-target="section"]` 的扩展不会失效。

状态键：`localStorage.navext.view`（`dir` | `time`）。

```js
NavExt.ui.setView('time');   // 切到时间视图
NavExt.ui.getView();         // → 'dir' | 'time'
NavExt.on('view-changed', function (e) { console.log(e.view); });
```

实现要点：切换时通过移动 DOM 节点（而非重建）改变归属，随后调用
`NavExt.notifyCardsChanged()` 让扩展重新索引；同时会重放当前搜索词。

### 主题切换 + 自定义主题色

头部右侧「外观」按钮打开一个弹出面板：

| 项 | 说明 |
|---|---|
| 主题三档 | **跟随系统** / **亮色** / **暗色**，状态键 `localStorage.navext.theme` |
| 预设色板 | 8 个精选主题色，点击即应用 |
| 取色器 | `<input type="color">` 自定义任意颜色 |
| 恢复默认 | 清除自定义色，回落到 `server.json` 的 `site.accent`（未配置则用默认 `#4f6ef7`） |

主题色优先级：**`localStorage.navext.accent` > `server.json` 的 `site.accent` > 内置默认 `#4f6ef7`**。

实现要点：

- 「跟随系统」= 移除 `<html data-theme>`，由 `@media (prefers-color-scheme: dark)` 接管；
  显式亮/暗 = 设 `data-theme="light"` / `data-theme="dark"`，同时声明 `color-scheme`
  让滚动条与原生控件跟随。
- **无闪烁（FOUC）**：`<head>` 最前面有一段极短的同步脚本（`data-ext-target="theme-boot"`），
  在样式表之前读取 `localStorage` 并设好 `data-theme` 与 `--brand`，因此首帧即为正确主题。

```js
NavExt.ui.setTheme('dark');      // 'system' | 'light' | 'dark'
NavExt.ui.setAccent('#10a37f');  // 传 null 恢复默认
NavExt.ui.getTheme();            // → 'system'
NavExt.ui.getAccent();           // → '#4f6ef7'
NavExt.ui.presets;               // 预设色板 [{name, color}, ...]
NavExt.on('theme-changed', function (e) { console.log(e.theme); });
NavExt.on('accent-changed', function (e) { console.log(e.accent); });
```

> **扩展如何配合**：内置 UI 会随着 `cards-rendered` 幂等挂载。
> 扩展的自定义样式请使用 `var(--brand)` / `var(--brand-ring)` 等 CSS 变量，
> 这样在用户切换主题色时会自动跟随。查看 `[data-nx-view]`（`main` 上）可判断当前视图。

---
