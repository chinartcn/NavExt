/* 示例 04 客户端脚本 —— 按热度给卡片加徽章
 *
 * v2.7 起，本示例改用官方 API，不再手写归一化与定时器管理：
 *   · NavExt.normalizePath()  —— 统一 URL / 相对两套路径体系（缺口 2）
 *   · NavExt.disposer()       —— 注册清理函数，禁用/卸载时自动执行（缺口 1）
 */
(function () {
  'use strict';

  var EXT_ID = 'ex4-reading-stats';

  function paint(stats) {
    if (!stats || !stats.counts) return;

    var color = NavExt.getExtConfigField(EXT_ID, 'hotColor') || '#e0447c';

    // 服务端 counts 的键是相对路径；getFiles()[].path 也是相对路径，
    // 这里统一走 normalizePath 归一化，避免大小写 / 前导斜杠差异导致键匹配失败。
    var counts = {};
    Object.keys(stats.counts).forEach(function (k) {
      counts[NavExt.normalizePath(k)] = stats.counts[k];
    });

    var hotSet = {};
    (stats.hotPaths || []).forEach(function (p) {
      hotSet[NavExt.normalizePath(p)] = true;
    });

    NavExt.getFiles().forEach(function (f) {
      var key = NavExt.normalizePath(f.path);
      var n = counts[key];
      if (!n) return;

      // 每个页面都显示访问次数
      NavExt.addCardBadge(f.path, '👁 ' + n, 'rgba(127,127,127,.18)', {
        key: 'nx-hits',
      });

      // 达阈值的额外加「热门」
      if (hotSet[key]) {
        NavExt.addCardBadge(f.path, '热门', color, { key: 'nx-hot' });
        NavExt.addCardClass(f.path, 'nx-hot-card');
      }
    });
  }

  function refresh() {
    if (NavExt.isDisposed(EXT_ID)) return;   // 已清理则不再发起请求
    NavExt.getExtStats(EXT_ID).then(paint).catch(function () { /* 忽略 */ });
  }

  // 事件订阅：保存 off 函数，dispose 时解绑
  var offCards = NavExt.on('cards-rendered', refresh);
  var offView = NavExt.on('view-changed', refresh);

  // 定时器：改用内核托管的清理注册，禁用/卸载时自动 clearInterval
  var timer = setInterval(refresh, 30000);

  NavExt.disposer(EXT_ID, function () {
    clearInterval(timer);
    offCards();
    offView();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh);
  } else {
    refresh();
  }
})();
