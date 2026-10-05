/* 示例 01 客户端脚本 —— 基本骨架 */
(function () {
  'use strict';

  NavExt.on('cards-rendered', function () {
    console.log('[示例 01] 卡片已渲染，共 ' + NavExt.getFiles().length + ' 个文件');
  });

  NavExt.on('view-changed', function (e) {
    console.log('[示例 01] 视图切换到：' + e.view);
  });
})();
