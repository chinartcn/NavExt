#!/usr/bin/env node
'use strict';

/**
 * cli.js — 项目管理工具
 *
 * 扩展管理:
 *   node cli.js create <name>       创建新扩展（交互式）
 *   node cli.js list                列出所有扩展
 *   node cli.js info <name>         查看扩展详情
 *   node cli.js enable <name>       启用扩展
 *   node cli.js disable <name>      禁用扩展
 *   node cli.js add <name>          把已有目录加入清单
 *   node cli.js remove <name>       删除扩展
 *
 * 构建与运行:
 *   node cli.js build               生成 server.dist.js
 *   node cli.js pack                打包成 app.tar.gz
 *   node cli.js sfx                 打包成自解压 app.sh
 *   node cli.js start               一键：构建 + 启动（dist）
 *   node cli.js dev                 直接运行源码（开发态）
 *
 * 通用选项:
 *   -r, --root <dir>      指定根目录
 *   -y, --yes             使用默认值
 *   -f, --force           覆盖已存在
 *   -V, --version         显示版本号
 *       --no-color        关闭彩色输出
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn, spawnSync } = require('child_process');

/* ============================================================ */
/*  颜色                                                         */
/* ============================================================ */

function useColor() {
  return process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
}

function paint(code, str) {
  return useColor() ? `\x1b[${code}m${str}\x1b[0m` : String(str);
}

const cyan   = (s) => paint('36', s);
const green  = (s) => paint('32', s);
const yellow = (s) => paint('33', s);
const red    = (s) => paint('31', s);
const gray   = (s) => paint('90', s);
const bold   = (s) => paint('1', s);

/* ============================================================ */
/*  常量                                                         */
/* ============================================================ */

const DEFAULT_DIR = '.js';
const LIST_FILE   = 'js.list.json';
const MOD_FILE    = 'mod.json';
const JS_FILE     = 'js.json';
const INDEX_FILE  = 'index.js';
const NAME_RE     = /^[a-zA-Z0-9_-]+$/;

/** 版本号单一事实来源 —— 从同目录 package.json 读取，失败则回落硬编码 */
const NAVEXT_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || '2.6.0';
  } catch {
    return '2.6.0';
  }
})();

/* ============================================================ */
/*  基础工具                                                     */
/* ============================================================ */

function readJsonSafe(p) {
  try {
    const text = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function rel(root, p) {
  const r = path.relative(root, p);
  return r || '.';
}

function resolveJsDir(root) {
  const serverPath = path.join(root, 'server.json');
  const cfg = readJsonSafe(serverPath);
  let dirName = DEFAULT_DIR;

  if (cfg && cfg.extensions && typeof cfg.extensions.dir === 'string') {
    const d = cfg.extensions.dir.trim();
    if (d && !d.includes('/') && !d.includes('\\') && d !== '.' && d !== '..') {
      dirName = d;
    }
  }
  return path.join(root, dirName);
}

function validateName(name) {
  if (!name || typeof name !== 'string') return '扩展名不能为空';
  const s = name.trim();
  if (!s) return '扩展名不能为空';
  if (s.length > 64) return '扩展名过长（最多 64 字符）';
  if (s.includes('/') || s.includes('\\')) return '扩展名不能包含路径分隔符';
  if (s.startsWith('.')) return '扩展名不能以点开头';
  if (!NAME_RE.test(s)) return '扩展名只能包含字母、数字、下划线和中划线';
  return null;
}

/* ---- js.list.json 读写 ---- */

function getListNames(data) {
  if (!data) return [];
  const out = [];

  const push = (id) => {
    if (typeof id === 'string' && id.trim()) out.push(id.trim());
  };

  const walk = (d) => {
    if (Array.isArray(d)) {
      for (const item of d) {
        if (typeof item === 'string') push(item);
        else if (item && typeof item === 'object') push(item.id || item.name);
      }
      return;
    }
    if (!d || typeof d !== 'object') return;
    if (d.extensions !== undefined) return walk(d.extensions);
    if (d.list !== undefined) return walk(d.list);
    for (const key of Object.keys(d)) push(key);
  };

  walk(data);
  return out;
}

function loadList(listPath) {
  const data = readJsonSafe(listPath);
  return {
    exists: fs.existsSync(listPath),
    names: getListNames(data),
  };
}

function saveList(listPath, names) {
  writeJson(listPath, { extensions: names });
}

/* ============================================================ */
/*  模板内容                                                     */
/* ============================================================ */

function tmplModJson({ name, displayName, description, author }) {
  return {
    name: displayName || name,
    description: description || '',
    version: '1.0.0',
    author: author || '',
    enabled: true,
    order: 100,
  };
}

function tmplJsJson() {
  return { styles: 'styles.css', scripts: 'client.js' };
}

function tmplIndexJs(name) {
  return `'use strict';

/**
 * ${name} 扩展 — 服务端钩子
 *
 * 可用钩子（均可为 async）:
 *   onInit(ctx)               扩展加载完成时调用
 *   onFiles(files, ctx)       扫描完成后调用，返回数组则替换文件列表
 *   onHtml(html, ctx)         HTML 生成后调用，返回字符串则替换 HTML
 *   onRequest(req, url, ctx)  请求路由前调用，返回对象则拦截并作为响应
 *   onResponse(info, ctx)     响应写出后调用，只做副作用（埋点/统计/日志），
 *                             不能改写响应。info = { method, pathname, url,
 *                             status, bytes, durationMs, headers, start }
 *
 * ctx 里可以直接读:
 *   ctx.config            合并后的配置值
 *   ctx.userConfig        用户显式覆盖的部分
 *   ctx.configSchema      schema 数组
 *   ctx.hasUserConfig     是否有用户覆盖
 *   ctx.fs                限定在扩展目录内的同步读写
 */

module.exports = {
  onInit(ctx) {
    ctx.log('已加载');
  },

  // onResponse(info, ctx) {
  //   // 例：统计访问量，再通过 stats() 暴露给 /api/extensions/<id>/stats
  //   ctx.log(info.method + ' ' + info.pathname + ' → ' + info.status + ' (' + info.durationMs + 'ms)');
  // },
};
`;
}

function tmplStylesCss(name) {
  return `/* ${name} 扩展的样式 */
/* 示例：.card { border-radius: 16px; } */
`;
}

function tmplClientJs(name) {
  return `/* ${name} 扩展的客户端脚本 */
(function () {
  'use strict';

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    // NavExt.on('cards-rendered', function () { ... });
  }
})();
`;
}

/* ============================================================ */
/*  交互问答                                                     */
/* ============================================================ */

function createRl() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, question, def) {
  return new Promise((resolve) => {
    const hint = def ? gray(` (${def})`) : '';
    rl.question(`${question}${hint}: `, (answer) => {
      const v = String(answer).trim();
      resolve(v || def || '');
    });
  });
}

function confirm(rl, question, def = false) {
  const hint = def ? '(Y/n)' : '(y/N)';
  return new Promise((resolve) => {
    rl.question(`${question} ${gray(hint)}: `, (answer) => {
      const a = String(answer).trim().toLowerCase();
      if (!a) return resolve(def);
      resolve(a === 'y' || a === 'yes');
    });
  });
}

/* ============================================================ */
/*  create 命令                                                  */
/* ============================================================ */

async function cmdCreate(args, opts) {
  let [name, displayName, description, author] = args;

  if (name) {
    const err = validateName(name);
    if (err) { console.error(red('✖'), err); process.exit(1); }
  }

  const jsDir = resolveJsDir(opts.root);
  const listPath = path.join(jsDir, LIST_FILE);

  if (!fs.existsSync(jsDir)) {
    fs.mkdirSync(jsDir, { recursive: true });
    console.log(gray(`  创建目录 ${rel(opts.root, jsDir)}`));
  }

  const list = loadList(listPath);
  let force = opts.force;
  let extDir = null;

  if (opts.yes) {
    if (!name) {
      console.error(red('✖'), '使用 --yes 时必须提供扩展名');
      process.exit(1);
    }
    displayName = displayName || name;
    description = description || '';
    author = author || '';
    extDir = path.join(jsDir, name);

    if (fs.existsSync(extDir) && !force) {
      console.error(red('✖'), `扩展 "${name}" 已存在（使用 --force 覆盖）`);
      process.exit(1);
    }
  } else {
    const rl = createRl();
    try {
      while (!name) {
        name = await ask(rl, '扩展名（目录名）');
        const err = validateName(name);
        if (err) { console.log(yellow('  ⚠'), err); name = ''; }
      }

      extDir = path.join(jsDir, name);

      if (fs.existsSync(extDir) && !force) {
        const ok = await confirm(rl, `  扩展 "${name}" 已存在，是否覆盖？`);
        if (!ok) { console.log(gray('  已取消')); return; }
        force = true;
      }

      if (displayName === undefined) displayName = await ask(rl, '显示名称', name);
      if (description === undefined) description = await ask(rl, '描述', '');
      if (author === undefined) author = await ask(rl, '作者', '');
    } finally {
      rl.close();
    }
  }

  fs.mkdirSync(extDir, { recursive: true });

  const files = {
    [MOD_FILE]: JSON.stringify(tmplModJson({ name, displayName, description, author }), null, 2) + '\n',
    [JS_FILE]: JSON.stringify(tmplJsJson(), null, 2) + '\n',
    [INDEX_FILE]: tmplIndexJs(name),
    'styles.css': tmplStylesCss(name),
    'client.js': tmplClientJs(name),
  };

  const created = [];
  const skipped = [];

  for (const [filename, content] of Object.entries(files)) {
    const filePath = path.join(extDir, filename);
    if (fs.existsSync(filePath) && !force) { skipped.push(filename); continue; }
    fs.writeFileSync(filePath, content, 'utf8');
    created.push(filename);
  }

  let listUpdated = false;
  if (!list.names.includes(name)) {
    list.names.push(name);
    saveList(listPath, list.names);
    listUpdated = true;
  }

  console.log('');
  console.log(green('  ✔'), `扩展 ${bold(name)} 创建成功`);
  console.log('');
  console.log(`  ${gray('位置')}  ${rel(opts.root, extDir)}/`);
  if (created.length) console.log(`  ${gray('新建')}  ${created.join(', ')}`);
  if (skipped.length) console.log(`  ${gray('保留')}  ${skipped.join(', ')} ${gray('(已存在)')}`);
  console.log(`  ${gray('清单')}  ${listUpdated ? '已追加到' : '已存在于'} ${rel(opts.root, listPath)}`);
  console.log('');
}

/* ============================================================ */
/*  list 命令                                                    */
/* ============================================================ */

function displayWidth(str) {
  let w = 0;
  for (const ch of String(str)) {
    const code = ch.codePointAt(0);
    if ((code >= 0x1100 && code <= 0x115f) ||
        (code >= 0x2e80 && code <= 0xa4cf) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6)) w += 2;
    else w += 1;
  }
  return w;
}

function pad(str, width) {
  const s = String(str);
  const w = displayWidth(s);
  if (w >= width) return s;
  return s + ' '.repeat(width - w);
}

function cmdList(args, opts) {
  const jsDir = resolveJsDir(opts.root);
  const listPath = path.join(jsDir, LIST_FILE);

  if (!fs.existsSync(jsDir)) {
    console.log(yellow('  扩展目录不存在：'), rel(opts.root, jsDir));
    console.log(gray('  运行 "node cli.js create <name>" 创建第一个扩展'));
    return;
  }

  const list = loadList(listPath);

  if (!list.names.length) {
    console.log(yellow('  清单为空：'), rel(opts.root, listPath));
    return;
  }

  const rows = list.names.map((name) => {
    const dir = path.join(jsDir, name);
    let dirOk = false;
    try { dirOk = fs.statSync(dir).isDirectory(); } catch {}
    const mod = readJsonSafe(path.join(dir, MOD_FILE)) || {};
    return {
      name,
      dirOk,
      enabled: mod.enabled !== false,
      displayName: (typeof mod.name === 'string' && mod.name.trim()) ? mod.name.trim() : name,
      version: typeof mod.version === 'string' ? mod.version.trim() : '',
      order: Number.isFinite(Number(mod.order)) ? Number(mod.order) : 100,
    };
  });

  rows.sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));

  console.log('');
  console.log(`  扩展目录  ${rel(opts.root, jsDir)}`);
  console.log(`  共 ${rows.length} 个扩展`);
  console.log('');

  const nameW = Math.max(4, ...rows.map((r) => displayWidth(r.name)));
  const dispW = Math.max(4, ...rows.map((r) => displayWidth(r.displayName)));

  const header = [
    pad('名称', nameW), pad('显示名称', dispW), pad('版本', 8), pad('顺序', 5), '状态',
  ].join('  ');

  console.log(gray('  ' + header));
  console.log(gray('  ' + '─'.repeat(header.length)));

  for (const r of rows) {
    const status = !r.dirOk ? red('目录缺失') : r.enabled ? green('启用') : gray('禁用');
    console.log('  ' + [
      pad(r.name, nameW), pad(r.displayName, dispW),
      pad(r.version || '-', 8), pad(String(r.order), 5), status,
    ].join('  '));
  }
  console.log('');
}

/* ============================================================ */
/*  info 命令                                                    */
/* ============================================================ */

function walkFiles(dir, root, out, depth) {
  if (depth > 6) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(full, root, out, depth + 1);
    else if (ent.isFile()) {
      try {
        const st = fs.statSync(full);
        out.push({ rel: path.relative(root, full).replace(/\\/g, '/'), size: st.size });
      } catch {}
    }
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function cmdInfo(args, opts) {
  const name = args[0];
  if (!name) { console.error(red('✖'), '请指定扩展名'); process.exit(1); }

  const jsDir = resolveJsDir(opts.root);
  const extDir = path.join(jsDir, name);

  if (!fs.existsSync(extDir)) {
    console.error(red('✖'), `扩展不存在：${rel(opts.root, extDir)}`);
    process.exit(1);
  }

  const mod = readJsonSafe(path.join(extDir, MOD_FILE)) || {};
  const jsCfg = readJsonSafe(path.join(extDir, JS_FILE)) || {};

  console.log('');
  console.log(bold(`  ${mod.name || name}`));
  console.log('');
  console.log(`  ${gray('目录')}      ${rel(opts.root, extDir)}/`);
  console.log(`  ${gray('ID')}        ${name}`);
  if (mod.version)     console.log(`  ${gray('版本')}      ${mod.version}`);
  if (mod.author)      console.log(`  ${gray('作者')}      ${mod.author}`);
  if (mod.description) console.log(`  ${gray('描述')}      ${mod.description}`);
  console.log(`  ${gray('顺序')}      ${Number.isFinite(Number(mod.order)) ? mod.order : 100}`);
  console.log(`  ${gray('状态')}      ${mod.enabled !== false ? green('启用') : gray('禁用')}`);

  const injKeys = ['styles', 'scripts', 'head', 'header', 'footer'];
  const present = injKeys.filter((k) => jsCfg[k] != null);

  if (present.length) {
    console.log('');
    console.log(`  ${gray('注入配置')}`);
    for (const k of present) {
      const v = Array.isArray(jsCfg[k]) ? jsCfg[k].join(', ') : String(jsCfg[k]);
      console.log(`    ${k.padEnd(8)} ${v.slice(0, 60)}`);
    }
  }

  const files = [];
  walkFiles(extDir, extDir, files, 0);

  if (files.length) {
    files.sort((a, b) => a.rel.localeCompare(b.rel));
    console.log('');
    console.log(`  ${gray('文件')}`);
    for (const f of files) console.log(`    ${f.rel}  ${gray('(' + formatSize(f.size) + ')')}`);
  }

  console.log('');
}

/* ============================================================ */
/*  enable / disable / add / remove                              */
/* ============================================================ */

function cmdToggleEnabled(args, opts, enable) {
  const name = args[0];
  if (!name) { console.error(red('✖'), '请指定扩展名'); process.exit(1); }

  const jsDir = resolveJsDir(opts.root);
  const extDir = path.join(jsDir, name);
  const modPath = path.join(extDir, MOD_FILE);

  if (!fs.existsSync(extDir)) {
    console.error(red('✖'), `扩展不存在：${rel(opts.root, extDir)}`);
    process.exit(1);
  }

  const mod = readJsonSafe(modPath) || {};
  mod.enabled = enable;
  writeJson(modPath, mod);

  console.log(green('  ✔'), `扩展 ${bold(name)} 已${enable ? green('启用') : gray('禁用')}`);
}

function cmdAdd(args, opts) {
  const name = args[0];
  if (!name) { console.error(red('✖'), '请指定扩展名'); process.exit(1); }

  const err = validateName(name);
  if (err) { console.error(red('✖'), err); process.exit(1); }

  const jsDir = resolveJsDir(opts.root);
  const extDir = path.join(jsDir, name);
  const listPath = path.join(jsDir, LIST_FILE);

  if (!fs.existsSync(extDir) || !fs.statSync(extDir).isDirectory()) {
    console.error(red('✖'), `扩展目录不存在：${rel(opts.root, extDir)}`);
    process.exit(1);
  }

  const list = loadList(listPath);
  if (list.names.includes(name)) {
    console.log(yellow('  ⚠'), `扩展 "${name}" 已在清单中`);
    return;
  }

  list.names.push(name);
  saveList(listPath, list.names);
  console.log(green('  ✔'), `扩展 ${bold(name)} 已加入清单`);
}

async function cmdRemove(args, opts) {
  const name = args[0];
  if (!name) { console.error(red('✖'), '请指定扩展名'); process.exit(1); }

  const jsDir = resolveJsDir(opts.root);
  const extDir = path.join(jsDir, name);
  const listPath = path.join(jsDir, LIST_FILE);

  const dirExists = fs.existsSync(extDir);
  const list = loadList(listPath);
  const inList = list.names.includes(name);

  if (!dirExists && !inList) {
    console.error(red('✖'), `扩展 "${name}" 不存在`);
    process.exit(1);
  }

  if (!opts.yes) {
    const rl = createRl();
    let ok;
    try {
      const extra = dirExists ? gray('（目录将被删除）') : '';
      ok = await confirm(rl, `  确认删除扩展 "${name}"？${extra}`);
    } finally {
      rl.close();
    }
    if (!ok) { console.log(gray('  已取消')); return; }
  }

  if (dirExists) {
    fs.rmSync(extDir, { recursive: true, force: true });
    console.log(`  ${gray('已删除')}  ${rel(opts.root, extDir)}/`);
  }
  if (inList) {
    const names = list.names.filter((n) => n !== name);
    saveList(listPath, names);
    console.log(`  ${gray('已移除')}  ${rel(opts.root, listPath)}`);
  }

  console.log('');
  console.log(green('  ✔'), `扩展 ${bold(name)} 已删除`);
}

/* ============================================================ */
/*  构建与运行                                                   */
/* ============================================================ */

/** 找 build.js / server.js 的位置（clijs 所在的目录） */
function findProjectRoot(opts) {
  // opts.root 只是给扩展管理用；构建相关文件在 cli.js 同目录
  return __dirname;
}

/** 同步执行 node <script> [args]，继承 stdio */
function runNode(scriptPath, args, label) {
  const r = spawnSync(process.execPath, [scriptPath].concat(args), {
    stdio: 'inherit',
    cwd: path.dirname(scriptPath),
  });
  if (r.error) {
    console.error(red('✖'), `${label} 失败：${r.error.message}`);
    process.exit(1);
  }
  if (r.status !== 0) {
    console.error(red('✖'), `${label} 退出码 ${r.status}`);
    process.exit(r.status || 1);
  }
}

async function cmdConfig(args, opts) {
  const root = opts.root;
  const cfgPath = path.join(root, "server.json");
  const argv2 = process.argv.slice(2);
  const showOnly = argv2.indexOf("--show") !== -1 || argv2.indexOf("-s") !== -1;
  const advanced = argv2.indexOf("--advanced") !== -1;

  let cfg = readJsonSafe(cfgPath) || {};

  // 历史遗留：extensions 是数组时其实是 htmlExtensions
  if (Array.isArray(cfg.extensions)) {
    if (!cfg.htmlExtensions) cfg.htmlExtensions = cfg.extensions;
    delete cfg.extensions;
    console.log(gray("  (已迁移 extensions 数组到 htmlExtensions)"));
  }

  if (showOnly) {
    console.log("");
    console.log("  配置文件 " + cfgPath);
    console.log("");
    console.log(JSON.stringify(cfg, null, 2));
    console.log("");
    return;
  }

  const rl = createRl();
  try {
    console.log("");
    console.log("  编辑 server.json —— 回车保留原值，输入 - 清空，Ctrl+C 取消");
    console.log("");

    if (!cfg.site) cfg.site = {};
    cfg.site.title = await ask(rl, "站点标题", cfg.site.title || "");
    cfg.site.description = await ask(rl, "站点描述", cfg.site.description || "");
    cfg.site.logo = await ask(rl, "Logo (emoji)", cfg.site.logo || "");
    cfg.site.footer = await ask(rl, "页脚文字", cfg.site.footer || "");
    cfg.site.accent = await ask(rl, "主题色 (如 #4f6ef7)", cfg.site.accent || "");

    const stats = await ask(rl, "显示文件统计 (y/n)", cfg.site.showStats === false ? "n" : "y");
    cfg.site.showStats = stats.charAt(0).toLowerCase() !== "n";

    const port = await ask(rl, "端口", String(cfg.port || 3000));
    cfg.port = parseInt(port, 10) || 3000;

    cfg.host = await ask(rl, "监听地址", cfg.host || "0.0.0.0");

    const depth = await ask(rl, "扫描深度", String(cfg.depth || 8));
    cfg.depth = parseInt(depth, 10) || 8;

    const igDirs = await ask(rl, "忽略目录（逗号分隔）", (cfg.ignoreDirs || []).join(", "));
    cfg.ignoreDirs = splitCsv(igDirs);

    const igFiles = await ask(rl, "忽略文件（逗号分隔）", (cfg.ignoreFiles || []).join(", "));
    cfg.ignoreFiles = splitCsv(igFiles);

    const htmlExt = await ask(rl, "HTML 扩展名（逗号分隔）", (cfg.htmlExtensions || [".html", ".htm"]).join(", "));
    cfg.htmlExtensions = splitCsv(htmlExt).map(normalizeExtName);

    if (!cfg.cache) cfg.cache = {};
    const cacheHtml = await ask(rl, "启用 HTML 渲染缓存 (y/n)", cfg.cache.html ? "y" : "n");
    cfg.cache.html = cacheHtml.charAt(0).toLowerCase() === "y";
    if (cfg.cache.html) {
      const extTtl = await ask(rl, "扩展指纹扫描间隔 (ms)", String(cfg.cache.extTtl || 1000));
      const nExt = parseInt(extTtl, 10);
      if (Number.isFinite(nExt) && nExt >= 100 && nExt <= 60000) cfg.cache.extTtl = nExt;
    }

    if (!cfg.home) cfg.home = {};
    const homeEnabled = await ask(rl, "启用自定义主页 (y/n)", cfg.home.enabled ? "y" : "n");
    cfg.home.enabled = homeEnabled.charAt(0).toLowerCase() === "y";

    if (cfg.home.enabled) {
      cfg.home.file = await ask(rl, "主页文件（相对 root）", cfg.home.file || "");
      const homeExt = await ask(rl, "主页应用扩展注入 (y/n)", cfg.home.applyExtensions ? "y" : "n");
      cfg.home.applyExtensions = homeExt.charAt(0).toLowerCase() === "y";
      if (cfg.home.routes && cfg.home.routes.length) {
        console.log(gray("  (" + cfg.home.routes.length + " 条 home.routes 保持原样)"));
      }
    }

    if (advanced) {
      console.log("");
      console.log(gray("  ── 高级 ──"));

      if (!cfg.api) cfg.api = {};
      const apiEn = await ask(rl, "启用 API (y/n)", cfg.api.enabled !== false ? "y" : "n");
      cfg.api.enabled = apiEn.charAt(0).toLowerCase() === "y";

      const apiWr = await ask(rl, "允许写操作 (y/n)", cfg.api.writable !== false ? "y" : "n");
      cfg.api.writable = apiWr.charAt(0).toLowerCase() === "y";

      if (!cfg.extensions) cfg.extensions = {};
      const extEn = await ask(rl, "启用扩展系统 (y/n)", cfg.extensions.enabled !== false ? "y" : "n");
      cfg.extensions.enabled = extEn.charAt(0).toLowerCase() === "y";
    }

    console.log("");
  } finally {
    rl.close();
  }

  if (fs.existsSync(cfgPath)) {
    const bak = cfgPath + ".bak." + Date.now();
    fs.copyFileSync(cfgPath, bak);
    console.log(gray("  备份 ") + rel(root, bak));
  }

  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + String.fromCharCode(10), "utf8");
  console.log("");
  console.log(green("  ✔"), "已保存 " + rel(root, cfgPath));
  console.log("");
}

function splitCsv(str) {
  if (!str) return [];
  return str.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
}

function normalizeExtName(s) {
  if (!s) return s;
  return s.charAt(0) === "." ? s : "." + s;
}

/* ─── jsx 子命令：子页扩展策略管理 ─── */

function findJsxFiles(root, out, depth) {
  if (depth > 6) return;
  var entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (var i = 0; i < entries.length; i++) {
    var ent = entries[i];
    var name = ent.name;
    if (name.startsWith('.') || name === 'node_modules') continue;
    var full = path.join(root, name);
    if (ent.isDirectory()) {
      findJsxFiles(full, out, depth + 1);
    } else if (name === 'jsx.json') {
      out.push(full);
    }
  }
}

function readJsxFile(p) {
  try {
    var text = fs.readFileSync(p, 'utf8');
    var data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    var enable = Array.isArray(data.enable) ? data.enable.filter(function (x) { return typeof x === 'string' && x.trim(); }) : null;
    var disable = Array.isArray(data.disable) ? data.disable.filter(function (x) { return typeof x === 'string' && x.trim(); }) : null;
    return { enable: enable, disable: disable, path: p };
  } catch (e) {
    return { error: e.message, path: p };
  }
}

function loadExtensionIds(root) {
  var jsDir = resolveJsDir(root);
  var listPath = path.join(jsDir, 'js.list.json');
  var data = readJsonSafe(listPath);
  return getListNames(data);
}

/* jsx list —— 列出所有 jsx.json */
function cmdJsxList(root) {
  var files = [];
  findJsxFiles(root, files, 0);

  if (files.length === 0) {
    console.log(yellow('  未找到任何 jsx.json'));
    console.log(gray('  在目录下创建 jsx.json 可声明该目录禁用的扩展'));
    return;
  }

  files.sort();
  console.log('');
  console.log('  共 ' + files.length + ' 个 jsx.json');
  console.log('');

  for (var i = 0; i < files.length; i++) {
    var rel = path.relative(root, files[i]) || 'jsx.json';
    var r = readJsxFile(files[i]);
    if (!r || r.error) {
      console.log(red('  ✖ ') + rel + gray('  (' + (r ? r.error : '解析失败') + ')'));
      continue;
    }
    var parts = [];
    if (r.enable) parts.push(green('enable:') + ' ' + r.enable.join(', '));
    if (r.disable) parts.push(yellow('disable:') + ' ' + r.disable.join(', '));
    if (parts.length === 0) parts.push(gray('(空)'));
    console.log('  ' + rel);
    for (var k = 0; k < parts.length; k++) console.log('    ' + parts[k]);
  }
  console.log('');
}

/* jsx show <path> —— 查看某路径累积策略 */
function cmdJsxShow(root, pathname) {
  if (!pathname) {
    console.error(red('✖'), '请指定路径，例如: node cli.js jsx show /docs');
    process.exit(1);
  }
  if (pathname.charAt(0) !== '/') pathname = '/' + pathname;

  var segs = pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  var dirs = [root];
  var acc = root;
  for (var i = 0; i < segs.length; i++) {
    var seg = segs[i];
    if (/\.[a-z0-9]+$/i.test(seg)) break;
    acc = path.join(acc, seg);
    dirs.push(acc);
  }

  console.log('');
  console.log('  请求路径  ' + pathname);
  console.log('  检查链');

  var policies = [];
  for (var i = 0; i < dirs.length; i++) {
    var p = path.join(dirs[i], 'jsx.json');
    if (!fs.existsSync(p)) {
      var rel0 = path.relative(root, dirs[i]) || '.';
      console.log(gray('    ' + rel0 + '/jsx.json') + gray('  (无)'));
      continue;
    }
    var r = readJsxFile(p);
    var rel = path.relative(root, p) || 'jsx.json';
    if (!r || r.error) {
      console.log(red('    ' + rel) + gray('  (' + (r ? r.error : '解析失败') + ')'));
      continue;
    }
    var parts = [];
    if (r.enable) parts.push(green('enable:') + ' ' + r.enable.join(', '));
    if (r.disable) parts.push(yellow('disable:') + ' ' + r.disable.join(', '));
    if (parts.length === 0) parts.push(gray('(空)'));
    console.log('    ' + rel + '  ' + parts.join('  '));
    policies.push(r);
  }

  console.log('');

  if (policies.length === 0) {
    console.log(gray('  未找到任何 jsx.json —— 该路径下所有扩展均加载'));
    console.log('');
    return;
  }

  // 累积判断
  var extIds = loadExtensionIds(root);
  var allowed = [];
  var denied = [];

  for (var i = 0; i < extIds.length; i++) {
    var id = extIds[i];
    var isAllowed = true;
    var sources = [];
    for (var j = 0; j < policies.length; j++) {
      var pol = policies[j];
      if (pol.enable && pol.enable.indexOf(id) === -1) {
        isAllowed = false;
        sources.push(path.relative(root, pol.path));
      } else if (pol.disable && pol.disable.indexOf(id) !== -1) {
        isAllowed = false;
        sources.push(path.relative(root, pol.path));
      }
    }
    if (isAllowed) allowed.push(id);
    else denied.push(id + '  ← ' + gray(sources.join(', ')));
  }

  console.log('  累积结果');
  console.log('');
  console.log(green('    允许 (' + allowed.length + ')'));
  for (var i = 0; i < allowed.length; i++) console.log('      ' + allowed[i]);
  if (denied.length) {
    console.log('');
    console.log(yellow('    禁用 (' + denied.length + ')'));
    for (var i = 0; i < denied.length; i++) console.log('      ' + denied[i]);
  }
  console.log('');
}

/* jsx check —— 检查所有 jsx.json 里的 ID 是否有效 */
function cmdJsxCheck(root) {
  var files = [];
  findJsxFiles(root, files, 0);

  if (files.length === 0) {
    console.log(yellow('  未找到任何 jsx.json'));
    return;
  }

  var extIds = loadExtensionIds(root);
  var extSet = {};
  for (var i = 0; i < extIds.length; i++) extSet[extIds[i]] = true;

  console.log('');
  console.log('  已加载扩展: ' + extIds.length + ' 个');
  console.log('  检查 ' + files.length + ' 个 jsx.json');
  console.log('');

  var issues = 0;
  var checked = 0;

  for (var i = 0; i < files.length; i++) {
    var rel = path.relative(root, files[i]) || 'jsx.json';
    var r = readJsxFile(files[i]);
    if (!r || r.error) {
      console.log(red('  ✖ ') + rel + gray('  (' + (r ? r.error : '解析失败') + ')'));
      issues++;
      continue;
    }
    var all = [];
    if (r.enable) for (var k = 0; k < r.enable.length; k++) all.push({ kind: 'enable', id: r.enable[k] });
    if (r.disable) for (var k = 0; k < r.disable.length; k++) all.push({ kind: 'disable', id: r.disable[k] });

    for (var k = 0; k < all.length; k++) {
      checked++;
      var item = all[k];
      if (!extSet[item.id]) {
        console.log(yellow('  ⚠ ') + rel + gray('  ' + item.kind + ': ') + item.id + yellow('  (扩展不存在)'));
        issues++;
      }
    }
  }

  console.log('');
  if (issues === 0) {
    console.log(green('  ✔ ') + '检查了 ' + checked + ' 个 ID，全部有效');
  } else {
    console.log(yellow('  ⚠ ') + '检查了 ' + checked + ' 个 ID，发现 ' + issues + ' 个问题');
  }
  console.log('');
}

/* jsx 命令入口 */
async function cmdJsx(args, opts) {
  var root = opts.root;
  var sub = args[0] || 'list';

  if (sub === 'list' || sub === 'ls') {
    cmdJsxList(root);
  } else if (sub === 'show') {
    cmdJsxShow(root, args[1]);
  } else if (sub === 'check') {
    cmdJsxCheck(root);
  } else if (sub === 'help' || sub === '-h' || sub === '--help') {
    console.log('');
    console.log('  用法: node cli.js jsx <子命令>');
    console.log('');
    console.log('    list            列出所有 jsx.json');
    console.log('    show <path>     查看某路径累积策略，如 show /docs');
    console.log('    check           检查 jsx.json 里的扩展 ID 是否有效');
    console.log('');
  } else {
    console.error(red('✖'), '未知子命令：' + sub);
    console.log(gray('  运行 "node cli.js jsx help" 查看帮助'));
    process.exit(1);
  }
}

function cmdBuild(args, opts) {
  const root = findProjectRoot(opts);
  const buildPath = path.join(root, 'build.js');
  if (!fs.existsSync(buildPath)) {
    console.error(red('✖'), `找不到 build.js：${buildPath}`);
    process.exit(1);
  }
  runNode(buildPath, args, 'build');
}

function cmdPack(args, opts) {
  const root = findProjectRoot(opts);
  const buildPath = path.join(root, 'build.js');
  if (!fs.existsSync(buildPath)) {
    console.error(red('✖'), `找不到 build.js：${buildPath}`);
    process.exit(1);
  }
  runNode(buildPath, ['--pack'].concat(args), 'pack');
}

function cmdSfx(args, opts) {
  const root = findProjectRoot(opts);
  const buildPath = path.join(root, 'build.js');
  if (!fs.existsSync(buildPath)) {
    console.error(red('✖'), `找不到 build.js：${buildPath}`);
    process.exit(1);
  }
  runNode(buildPath, ['--pack', '--sfx'].concat(args), 'sfx');
}

function cmdStart(args, opts) {
  const root = findProjectRoot(opts);
  const buildPath = path.join(root, 'build.js');
  const distPath = path.join(root, 'server.dist.js');

  // 1) 构建
  if (fs.existsSync(buildPath)) {
    console.log(gray('  → 构建 server.dist.js'));
    runNode(buildPath, [], 'build');
  } else if (!fs.existsSync(distPath)) {
    console.error(red('✖'), '既没有 build.js 也没有 server.dist.js');
    process.exit(1);
  }

  // 2) 启动
  console.log(gray('  → 启动 server.dist.js'));
  console.log('');

  const child = spawn(process.execPath, [distPath].concat(args), {
    stdio: 'inherit',
    cwd: root,
  });

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code || 0);
  });

  // 转发信号
  ['SIGINT', 'SIGTERM'].forEach((sig) => {
    process.on(sig, () => child.kill(sig));
  });
}

function cmdDev(args, opts) {
  const root = findProjectRoot(opts);
  const serverPath = path.join(root, 'server.js');

  if (!fs.existsSync(serverPath)) {
    console.error(red('✖'), `找不到 server.js：${serverPath}`);
    process.exit(1);
  }

  const child = spawn(process.execPath, [serverPath].concat(args), {
    stdio: 'inherit',
    cwd: root,
  });

  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code || 0);
  });

  ['SIGINT', 'SIGTERM'].forEach((sig) => {
    process.on(sig, () => child.kill(sig));
  });
}

/* ============================================================ */
/*  帮助                                                         */
/* ============================================================ */

function printHelp() {
  console.log(`
  ${bold('cli.js')} — 项目管理工具

  ${bold('扩展管理')}
    ${cyan('create <name>')}    创建新扩展（交互式）
    ${cyan('list')}             列出所有扩展
    ${cyan('info <name>')}      查看扩展详情
    ${cyan('enable <name>')}    启用扩展
    ${cyan('disable <name>')}   禁用扩展
    ${cyan('add <name>')}       把已有目录加入清单
    ${cyan('remove <name>')}    删除扩展

  ${bold('构建与运行')}
    ${cyan('build')}            生成 server.dist.js
    ${cyan('pack')}             打包成 app.tar.gz
    ${cyan('sfx')}              打包成自解压 app.sh
    ${cyan('start')}            一键：构建 + 启动（dist）
    ${cyan('dev')}              直接运行源码（开发态）
    ${cyan('config')}           交互式编辑 server.json

  ${bold('通用选项')}
    -r, --root <dir>      指定根目录（扩展管理用）
    -y, --yes             使用默认值
    -f, --force           覆盖已存在
        --no-color        关闭彩色输出
    -V, --version         显示版本号
    -h, --help            显示帮助

  ${bold('示例')}
    ${gray('# 建一个扩展')}
    node cli.js create darkmode

    ${gray('# 构建单文件')}
    node cli.js build

    ${gray('# 打包成 tar.gz')}
    node cli.js pack

    ${gray('# 打包成自解压 .sh')}
    node cli.js sfx

    ${gray('# 一键构建并启动')}
    node cli.js start

    ${gray('# 开发时直接跑源码')}
    node cli.js dev
    node cli.js config

    ${gray('# 传给 server 的参数')}
    node cli.js start -- --port 8080

  ${bold('在打包后的目录里')}
    ${gray('# 解压 tar.gz 后')}
    ./start.sh

    ${gray('# 运行自解压 .sh')}
    ./app.sh
    ./app.sh --keep ./myapp       # 解压到指定目录
    ./app.sh --extract ./myapp    # 只解压，不启动
`);
}

/* ============================================================ */
/*  参数解析                                                     */
/* ============================================================ */

function parseArgs(argv) {
  const opts = { root: process.cwd(), yes: false, force: false, help: false, version: false };
  const rest = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-r' || a === '--root')     opts.root = argv[++i];
    else if (a.startsWith('--root='))     opts.root = a.slice(7);
    else if (a === '-y' || a === '--yes') opts.yes = true;
    else if (a === '-f' || a === '--force') opts.force = true;
    else if (a === '-V' || a === '--version') opts.version = true;
    else if (a === '--no-color')          process.env.NO_COLOR = '1';
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('-'))           { /* 未知选项 */ }
    else rest.push(a);
  }

  opts.root = path.resolve(opts.root);
  return { opts, rest };
}

/* ============================================================ */
/*  入口                                                         */
/* ============================================================ */

async function main() {
  const { opts, rest } = parseArgs(process.argv.slice(2));

  if (opts.version) {
    console.log(`navext v${NAVEXT_VERSION}`);
    return;
  }

  if (opts.help || rest.length === 0) {
    printHelp();
    return;
  }

  const [cmd, ...args] = rest;

  switch (cmd) {
    /* 扩展管理 */
    case 'create': case 'new': case 'init':  await cmdCreate(args, opts); break;
    case 'list':   case 'ls':                cmdList(args, opts); break;
    case 'info':   case 'show':              cmdInfo(args, opts); break;
    case 'enable':                           cmdToggleEnabled(args, opts, true); break;
    case 'disable':                          cmdToggleEnabled(args, opts, false); break;
    case 'add':                              cmdAdd(args, opts); break;
    case 'remove': case 'rm': case 'delete': await cmdRemove(args, opts); break;

    /* 构建与运行 */
    case 'build':                            cmdBuild(args, opts); break;
    case 'pack':                             cmdPack(args, opts); break;
    case 'sfx':                              cmdSfx(args, opts); break;
    case 'start': case 'run':                cmdStart(args, opts); break;
    case 'dev':                              cmdDev(args, opts); break;
    case 'config': case 'cfg':               await cmdConfig(args, opts); break;
    case 'jsx':                              await cmdJsx(args, opts); break;

    case 'help':                             printHelp(); break;

    default:
      console.error(red('✖'), `未知命令：${cmd}`);
      console.log(gray('  运行 "node cli.js help" 查看可用命令'));
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(red('✖'), err.message);
  if (process.env.DEBUG) console.error(err.stack);
  process.exit(1);
});