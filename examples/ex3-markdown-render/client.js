/* 示例 03 客户端脚本 —— 给 .md 链接加个标记 */
(function () {
  'use strict';

  NavExt.on('cards-rendered', function () {
    NavExt.getFiles().forEach(function (f) {
      if (/\.md$/i.test(f.name)) {
        NavExt.addCardBadge(f.path, 'MD', '#4f6ef7', { key: 'nx-md' });
      }
    });
  });
})();
