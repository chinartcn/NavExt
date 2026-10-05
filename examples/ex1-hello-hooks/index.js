'use strict';

/**
 * 示例 01 —— 钩子全览（教学）
 *
 * 这个扩展不干实事，只为把六个服务端钩子挨个演示一遍，
 * 并把「谁先谁后」「返回值怎么用」打在日志里。
 *
 * 钩子执行顺序（单个请求生命周期）：
 *
 *   onInit            服务启动 / 扩展重载时，跑一次
 *   onFiles   ─┐
 *              ├─ 扫描到文件后、生成 HTML 之前
 *   onHtml    ─┘
 *   onRequest         收到任意 HTTP 请求时（可短路返回）
 *   onResponse        响应即将发出时（可改状态/头/体）
 *   stats             被 /api/extensions/:id/stats 查询时
 *
 * 全部钩子都可以是 async —— 内核用 `await Promise.resolve(fn(...))`
 * 统一处理，同步抛错和异步 reject 表现一致。
 */

/* ── onInit：只跑一次，适合建缓存、读配置、起定时器 ── */
let startedAt = 0;

function onInit(ctx) {
  startedAt = Date.now();
  ctx.log('✅ onInit：扩展已初始化');
  ctx.log('   我的目录是：', ctx.extDir);
  ctx.log('   站点根目录是：', ctx.root);
}

/* ── onFiles：拿到扫描结果，可以改标题、过滤、排序 ──
 * 返回值约定（重要）：
 *   返回数组       → 用它替换原列表
 *   其它任何值     → 忽略，保持原列表不变
 *   ⚠️ 必须是「同步」返回数组。若返回 Promise，内核只用来吞异常，
 *      结果会被丢弃 —— 异步 onFiles 无法改变文件列表。
 */
function onFiles(files, ctx) {
  ctx.log('📂 onFiles：扫描到', files.length, '个文件');

  // 演示：给所有没有标题的文件补一个「文件名（无标题）」
  return files.map(function (f) {
    if (!f.title) {
      f.title = f.name.replace(/\.html?$/i, '') + '（无标题）';
    }
    return f;
  });
}

/* ── onHtml：HTML 已生成，字符串可直接替换 ──
 * 返回值约定：
 *   返回字符串     → 用它替换原 HTML
 *   返回 undefined → 保持原 HTML 不变
 */
function onHtml(html, ctx) {
  ctx.log('📄 onHtml：HTML 长度', html.length);

  // 演示：往 </body> 前塞一行注释（无副作用，方便在「查看源码」里验证）
  return html.replace(
    '</body>',
    '<!-- 本页由示例扩展 ex1-hello-hooks 处理过 -->\n</body>'
  );
}

/* ── onRequest：拦截任意 HTTP 请求 ──
 * 返回值约定：
 *   返回「对象」       → 短路，内核直接用它作为响应
 *   返回其它任何东西   → 继续正常流程
 *   返回对象支持字段：{ status, headers, body, type }
 *
 * ⚠️ 内核自留了 /api/* 命名空间（配置 / 扩展 / FS），它在 onRequest 之前
 *    就被处理。所以扩展**不能**占用 /api/*，请用自己的前缀。
 */
function onRequest(req, url, ctx) {
  // 演示：加一个虚拟接口（用自己的前缀，避开 /api）
  if (url.pathname === '/hello-hooks/status') {
    return {
      status: 200,
      type: 'application/json; charset=utf-8',
      body: JSON.stringify({
        message: '你好，我是示例扩展 ex1-hello-hooks',
        uptimeMs: Date.now() - startedAt,
        node: process.version,   // 注意：扩展运行在服务端，能用 process
      }),
    };
  }
  // 其它请求一律放行
  return undefined;
}

/* ── onResponse：响应发出后触发，只读观察 ──
 * ⚠️ 这是「事后」钩子：返回值会被忽略，你也拿不到 res 对象，
 *    只有一份快照 info —— 因此它适合统计/打点，不适合改响应。
 *    info = { method, pathname, url, status, bytes, durationMs, headers, start }
 */
function onResponse(info, ctx) {
  ctx.log('📤 onResponse：', info.method, info.pathname,
          '→', info.status, info.bytes + 'B', info.durationMs + 'ms');
}

/* ── stats：被查询时同步返回 JSON，用于暴露运行时指标 ── */
function stats(ctx) {
  return {
    startedAt: startedAt,
    uptimeMs: Date.now() - startedAt,
    pid: process.pid,
  };
}

module.exports = { onInit, onFiles, onHtml, onRequest, onResponse, stats };
