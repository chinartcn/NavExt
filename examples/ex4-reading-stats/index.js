'use strict';

/**
 * 示例 04 —— 阅读时长与热度
 *
 * 演示服务端「埋点 + 暴露指标」的完整闭环：
 *
 *   onResponse  ──►  累加统计（访问次数、总耗时）
 *        │
 *        ▼
 *   stats()     ──►  GET /api/extensions/ex4-reading-stats/stats
 *        │
 *        ▼
 *   client.js   ──►  NavExt.getExtStats() 取回，给卡片加「热门」徽章
 *
 * 关键点：onResponse 是「事后」钩子，拿不到 res，只能读一份只读快照 ——
 * 正适合做计数这种纯副作用，不会干扰响应本身。
 */

/* 路径 → { count, totalMs, lastAt } */
const hits = new Map();
let startedAt = Date.now();

function onInit(ctx) {
  startedAt = Date.now();
  ctx.log('✅ 统计埋点已启动');
}

function onResponse(info, ctx) {
  const cfg = ctx.config || {};

  // 可选：跳过 /api/*
  if (!cfg.trackApi && /^\/api(\/|$)/.test(info.pathname)) return;
  // 只统计成功的页面
  if (info.status >= 400) return;

  let rec = hits.get(info.pathname);
  if (!rec) {
    rec = { count: 0, totalMs: 0, lastAt: 0 };
    hits.set(info.pathname, rec);
  }
  rec.count += 1;
  rec.totalMs += info.durationMs || 0;
  rec.lastAt = Date.now();
}

/** 暴露给客户端 / 运维的指标 */
function stats(ctx) {
  const cfg = ctx.config || {};
  const hotThreshold = cfg.hotThreshold || 5;

  const pages = [];
  let totalHits = 0;
  let totalMs = 0;

  for (const [pathname, rec] of hits) {
    pages.push({
      pathname: pathname,
      count: rec.count,
      avgMs: rec.count ? Math.round((rec.totalMs / rec.count) * 100) / 100 : 0,
      lastAt: rec.lastAt,
      hot: rec.count >= hotThreshold,
    });
    totalHits += rec.count;
    totalMs += rec.totalMs;
  }

  // 按访问量倒序
  pages.sort((a, b) => b.count - a.count);

  /* ── 键归一化（重要）──
   * onResponse 的 info.pathname 是「请求路径」，带前导斜杠：
   *     '/'               首页
   *     '/docs/a.html'
   * 而客户端 NavExt.getFiles()[].path 是「仓库相对路径」，不带斜杠：
   *     'index.html'      首页
   *     'docs/a.html'
   * 两者对不上，客户端就永远匹配不到。这里统一转成相对路径再下发。
   */
  const toRel = (p) => p === '/' ? 'index.html' : p.replace(/^\/+/, '');

  return {
    startedAt: startedAt,
    uptimeMs: Date.now() - startedAt,
    pagesTracked: hits.size,
    totalHits: totalHits,
    avgMsOverall: totalHits ? Math.round((totalMs / totalHits) * 100) / 100 : 0,
    hotThreshold: hotThreshold,
    top: pages.slice(0, 20),
    // 键已归一化为相对路径，直接与 getFiles()[].path 对齐
    counts: pages.reduce((acc, p) => { acc[toRel(p.pathname)] = p.count; return acc; }, {}),
    hotPaths: pages.filter((p) => p.hot).map((p) => toRel(p.pathname)),
  };
}

module.exports = { onInit, onResponse, stats };
