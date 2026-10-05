/* 示例 02 客户端脚本 —— 卡片标记 */
(function () {
  'use strict';

  /* ── 工具：把字节数变成人类可读 ── */
  function human(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  /* ── 工具：相对时间 ── */
  function ago(ms) {
    var d = Date.now() - ms;
    if (d < 60000) return '刚刚';
    if (d < 3600000) return Math.floor(d / 60000) + ' 分钟前';
    if (d < 86400000) return Math.floor(d / 3600000) + ' 小时前';
    return Math.floor(d / 86400000) + ' 天前';
  }

  /* ── 核心：给每个卡片加信息 ──
   * 必须监听 cards-rendered —— 卡片是内核渲染的，扩展要等它渲染完再动。
   * 视图切换、搜索都会重渲染，所以这里用「幂等」写法：重复调用安全。
   */
  function decorate() {
    NavExt.getFiles().forEach(function (f) {
      /* 1) 徽章：文件大小 */
      NavExt.addCardBadge(f.path, human(f.size), 'rgba(127,127,127,.18)', {
        key: 'nx-size',
      });

      /* 2) 徽章：修改时间（仅 7 天内，避免噪音） */
      if (Date.now() - f.mtime < 7 * 86400000) {
        NavExt.addCardBadge(f.path, ago(f.mtime), '#e08e0b', { key: 'nx-ago' });
      }

      /* 3) 图标：用内联 SVG data URL 加一个小文件图标 */
      var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
                '<path fill="#7a8496" d="M4 1h5l3 3v11H4z"/>' +
                '<path fill="#fff" d="M9 1v3h3"/>' +
                '</svg>';
      NavExt.addCardIcon(f.path, 'data:image/svg+xml,' + encodeURIComponent(svg), {
        key: 'nx-fileicon',
        size: 14,
        alt: '文件',
      });

      /* 4) 自定义属性：把 path 写到 data 上，方便其它扩展或测试选取 */
      NavExt.setCardAttribute(f.path, 'data-nx-basename', f.name);

      /* 5) 自定义类：超大文件（>100KB）标红 */
      if (f.size > 100 * 1024) {
        NavExt.addCardClass(f.path, 'nx-large-file');
      } else {
        NavExt.removeCardClass(f.path, 'nx-large-file');
      }
    });
  }

  /* 卡片每次渲染完 + 视图切换后都要重新装饰 */
  NavExt.on('cards-rendered', decorate);
  NavExt.on('view-changed', decorate);

  /* 首次进入立即跑一次（若 DOM 已就绪） */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', decorate);
  } else {
    decorate();
  }

  /* 暴露出去方便在控制台手动调试 */
  window.__demo02 = { decorate: decorate, human: human };
})();
