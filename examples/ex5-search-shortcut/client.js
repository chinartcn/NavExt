'use strict';

/**
 * 示例 05 —— 键盘快捷键与视图控制
 *
 * 演示两件事：
 *   1. NavExt.ui —— v2.6 新增的内置 UI 控制 API（视图 / 主题 / 主题色）；
 *   2. 如何监听键盘、与内置搜索框协作。
 *
 * ui API 一览（全部是同步的）：
 *   NavExt.ui.setView('dir'|'time')   切换「按目录 / 按时间」视图
 *   NavExt.ui.getView()               读当前视图
 *   NavExt.ui.setTheme('system'|'light'|'dark')
 *   NavExt.ui.getTheme()
 *   NavExt.ui.setAccent('#rrggbb')    设置主题色
 *   NavExt.ui.getAccent()
 *   NavExt.ui.presets                 预置色数组 [{name, color}, ...]
 */

function isTyping(el) {
  if (!el) return false;
  var tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

function toggleTheme() {
  var order = ['system', 'light', 'dark'];
  var cur = NavExt.ui.getTheme();
  var next = order[(order.indexOf(cur) + 1) % order.length];
  NavExt.ui.setTheme(next);
  toast('主题：' + next);
}

function toggleView() {
  var next = NavExt.ui.getView() === 'time' ? 'dir' : 'time';
  NavExt.ui.setView(next);
  toast('视图：' + (next === 'time' ? '按时间' : '按目录'));
}

function cycleAccent() {
  var presets = NavExt.ui.presets || [];
  if (!presets.length) return;
  var cur = NavExt.ui.getAccent();
  var idx = 0;
  for (var i = 0; i < presets.length; i++) {
    if (presets[i].color.toLowerCase() === String(cur).toLowerCase()) { idx = i; break; }
  }
  var next = presets[(idx + 1) % presets.length];
  NavExt.ui.setAccent(next.color);
  toast('主题色：' + (next.name || next.color));
}

function focusSearch() {
  var input = document.querySelector('[data-ext-target="search-input"]') ||
              document.querySelector('[data-ext-target="search"] input');
  if (input) { input.focus(); input.select && input.select(); }
}

function clearSearch() {
  var input = document.querySelector('[data-ext-target="search-input"]') ||
              document.querySelector('[data-ext-target="search"] input');
  if (input) {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/* ── 一个轻量提示气泡（不依赖任何第三方） ── */
var toastEl = null;
var toastTimer = 0;
function toast(msg) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'nx-toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { toastEl.classList.remove('on'); }, 1400);
}

/* ── 键盘绑定 ── */
document.addEventListener('keydown', function (e) {
  // 在输入框里打字时不劫持，避免影响正常输入（Esc 除外）
  if (isTyping(document.activeElement) && e.key !== 'Escape') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  switch (e.key) {
    case '/': e.preventDefault(); focusSearch(); break;
    case 't': case 'T': toggleTheme(); break;
    case 'v': case 'V': toggleView(); break;
    case 'c': case 'C': cycleAccent(); break;
    case 'Escape': clearSearch(); break;
  }
});
