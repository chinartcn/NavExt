'use strict';

/**
 * 示例 03 —— Markdown 渲染
 *
 * 演示三件事：
 *   1. 如何声明配置项（js.json 的 config），并在服务端用 ctx.config 读取；
 *   2. 如何用 onRequest 拦截一类 URL（这里是 *.md），自己读文件生成响应；
 *   3. 如何做安全：转义用户内容 + 限制体积，避免 XSS 与内存膨胀。
 *
 * ⚠️ 关于读文件：ctx.fs 被限制在**扩展自己的目录**内，读不了项目文件。
 *    要读站点里的 .md，必须用原生 require('fs') —— 这也印证了文档里那句
 *    「扩展 = 完全信任」，ctx.fs 只是便利封装，不是安全边界。
 */

const fs = require('fs');
const path = require('path');

/* ── 极简 Markdown → HTML ──
 * 真项目里请用 markdown-it / marked；这里手写一份，保持「零依赖」的示例性质。
 */
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, text, href) {
      // 只允许 http/https/相对路径，挡掉 javascript: 伪协议
      if (!/^(https?:|\/|\.\/|#)/i.test(href)) return esc(text);
      return '<a href="' + esc(href) + '">' + esc(text) + '</a>';
    });
}

function mdToHtml(md, accent) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let inCode = false;
  let inList = false;

  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };

  for (const line of lines) {
    if (/^```/.test(line)) {
      closeList();
      out.push(inCode ? '</pre>' : '<pre>');
      inCode = !inCode;
      continue;
    }
    if (inCode) { out.push(esc(line)); continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      closeList();
      const lv = h[1].length;
      out.push('<h' + lv + ' style="color:' + accent + '">' + inline(h[2]) + '</h' + lv + '>');
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + inline(line.replace(/^\s*[-*]\s+/, '')) + '</li>');
      continue;
    }
    if (!line.trim()) { closeList(); continue; }
    closeList();
    out.push('<p>' + inline(line) + '</p>');
  }
  closeList();
  if (inCode) out.push('</pre>');
  return out.join('\n');
}

/* ── onRequest：拦截 .md 请求 ── */
function onRequest(req, url, ctx) {
  if (!/\.md$/i.test(url.pathname)) return undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') return undefined;

  const cfg = ctx.config || {};
  const maxBytes = cfg.maxBytes || 262144;
  const accent = cfg.accentHeading || '#4f6ef7';

  // 用站点根目录 + 请求路径拼绝对路径，并防目录穿越
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const abs = path.resolve(ctx.root, rel);

  if (path.relative(ctx.root, abs).startsWith('..')) {
    return { status: 403, type: 'text/plain; charset=utf-8', body: '403 越界' };
  }
  if (!fs.existsSync(abs)) return undefined;   // 没这个文件，交回内核（会 404）

  const st = fs.statSync(abs);
  if (st.size > maxBytes) {
    return {
      status: 413,
      type: 'text/plain; charset=utf-8',
      body: '文件过大（' + st.size + ' 字节），超过 maxBytes=' + maxBytes,
    };
  }

  const md = fs.readFileSync(abs, 'utf8');
  const body = '<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(path.basename(abs)) + '</title>' +
    '<link rel="stylesheet" href="/.js/ex3-markdown-render/styles.css">' +
    '</head><body class="nx-md"><article>' +
    mdToHtml(md, accent) +
    '</article></body></html>';

  return { status: 200, type: 'text/html; charset=utf-8', body };
}

function onInit(ctx) {
  ctx.log('✅ Markdown 渲染器就绪；标题色=', ctx.config.accentHeading);
}

module.exports = { onInit, onRequest };
