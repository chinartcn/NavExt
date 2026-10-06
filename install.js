#!/usr/bin/env node
/**
 * NavExt 安装脚本 —— 内置展示页扩展（v2.8.3）
 *
 * 从 v2.8.3 起，原本内置在 server.js 里的「导航页 / 展示页」被降级为
 * 可选的扩展构件（.js/navext-ui/）。不安装它时：
 *   - 根路径 / 会服务站点根目录的 index.html；
 *   - 没有 index.html 则返回 HTTP 200 + 0 字节空页面；
 *   - 其他扩展照常加载与工作。
 *
 * 本脚本先探测是否已安装，再询问是否安装。零依赖、可单独分发。
 *
 * 用法：
 *   node install.js              交互式（先探测再询问）
 *   node install.js --yes        非交互，直接安装
 *   node install.js --no         非交互，跳过
 *   node install.js --dry-run    只探测与汇报，不做任何改动
 *   node install.js --root <dir> 指定部署目录（默认脚本所在目录）
 *   node install.js --force      已安装时也重新覆盖
 *   node install.js --help
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

/* ── 常量 ────────────────────────────────────────────────────── */

const UI_EXT_ID = 'navext-ui';
const EXTS_DIR = '.js';
const LIST_FILE = 'js.list.json';

/**
 * 「安装载荷」相对路径（v2.8.3）。
 *
 * 用 --no-ui-ext 打包时，.js/navext-ui/ 被排除，但其源文件被放在
 * .js-install/navext-ui/ 作为载荷 —— 内核不会扫描该目录，
 * 只有本脚本会用它来安装。源码目录里两种位置都可能存在，按顺序找。
 */
const PAYLOAD_REL = path.join('.js-install', UI_EXT_ID);

/** 依次尝试：源码目录的 .js-install/ 载荷，再到 .js/ 原位 */
function resolveSource(root) {
  const candidates = [
    path.join(root, PAYLOAD_REL),
    path.join(__dirname, PAYLOAD_REL),
    path.join(__dirname, EXTS_DIR, UI_EXT_ID),
    path.join(root, EXTS_DIR, UI_EXT_ID),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'mod.json'))) return dir;
    } catch {}
  }
  return null;
}

/* ── 颜色（无依赖，非 TTY 时自动降级） ───────────────────────── */

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code, s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const dim   = (s) => c('2', s);
const green = (s) => c('32', s);
const red   = (s) => c('31', s);
const yellow = (s) => c('33', s);
const bold  = (s) => c('1', s);

/* ── 参数解析 ────────────────────────────────────────────────── */

function parseArgs(argv) {
  const o = { root: null, yes: false, no: false, dryRun: false, force: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--yes' || a === '-y') o.yes = true;
    else if (a === '--no' || a === '-n') o.no = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--force' || a === '-f') o.force = true;
    else if (a === '--root') o.root = argv[++i];
    else if (a.startsWith('--root=')) o.root = a.slice(7);
    else if (a === '--help' || a === '-h') o.help = true;
  }
  return o;
}

function printHelp() {
  console.log(`
用法: node install.js [选项]

安装 NavExt 内置展示页扩展（.js/${UI_EXT_ID}）。

选项:
  -y, --yes        直接安装，不询问
  -n, --no         跳过安装，不询问
      --dry-run    只探测当前状态并汇报，不做任何改动
      --force      已安装时也覆盖重装
      --root <dir> 指定部署目录（默认脚本所在目录）
  -h, --help       显示帮助

不安装时根路径 / 的行为:
  ① 站点根目录有 index.html  → 服务它（注入扩展）
  ② 没有 index.html          → HTTP 200 + 0 字节空页面
  其他扩展在任何情况下都照常加载。

安装后也可以随时手动删除 .js/${UI_EXT_ID}/ 来卸载（并同步移除
${EXTS_DIR}/${LIST_FILE} 里对应的条目）。
`);
}

/* ── 交互问答 ────────────────────────────────────────────────── */

function createRl() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function confirm(rl, question, def) {
  const hint = def ? '(Y/n)' : '(y/N)';
  return new Promise((resolve) => {
    rl.question(`${question} ${dim(hint)}: `, (answer) => {
      const a = String(answer).trim().toLowerCase();
      if (!a) return resolve(def);
      resolve(a === 'y' || a === 'yes');
    });
  });
}

/* ── 探测 ────────────────────────────────────────────────────── */

/**
 * 探测展示页扩展的安装状态。
 * @returns {{ root, extDir, extsDir, listPath, dirExists, inList, listFormat, listBroken }}
 */
function probe(root) {
  const extsDir = path.join(root, EXTS_DIR);
  const extDir = path.join(extsDir, UI_EXT_ID);
  const listPath = path.join(extsDir, LIST_FILE);

  const r = {
    root, extDir, extsDir, listPath,
    dirExists: fs.existsSync(path.join(extDir, 'mod.json')),
    inList: false,
    listFormat: 'none',
    listBroken: false,
    listExists: fs.existsSync(listPath),
    rootHasIndex: fs.existsSync(path.join(root, 'index.html')),
  };

  if (r.listExists) {
    try {
      const raw = JSON.parse(fs.readFileSync(listPath, 'utf8'));
      if (Array.isArray(raw)) {
        r.listFormat = 'array';
        r.inList = raw.includes(UI_EXT_ID);
      } else if (raw && Array.isArray(raw.extensions)) {
        r.listFormat = 'object.extensions';
        r.inList = raw.extensions.includes(UI_EXT_ID);
      } else if (raw && Array.isArray(raw.list)) {
        r.listFormat = 'object.list';
        r.inList = raw.list.includes(UI_EXT_ID);
      } else if (raw && typeof raw === 'object') {
        // { "id": scope } 形态
        r.listFormat = 'object.map';
        r.inList = Object.prototype.hasOwnProperty.call(raw, UI_EXT_ID);
      }
    } catch {
      r.listBroken = true;
    }
  }

  return r;
}

/* ── 清单改写 ────────────────────────────────────────────────── */

/**
 * 把 UI_EXT_ID 加入 js.list.json（幂等）。
 * 保留原有形态，不改变结构。
 */
function addToList(state) {
  const { listPath, extsDir } = state;

  if (!fs.existsSync(extsDir)) fs.mkdirSync(extsDir, { recursive: true });

  let raw;
  if (fs.existsSync(listPath)) {
    try {
      raw = JSON.parse(fs.readFileSync(listPath, 'utf8'));
    } catch (err) {
      throw new Error(`${LIST_FILE} 不是合法 JSON：${err.message}`);
    }
  } else {
    raw = { extensions: [] };
  }

  const pushUnique = (arr) => (arr.includes(UI_EXT_ID) ? arr : [UI_EXT_ID, ...arr]);

  let next;
  if (Array.isArray(raw)) next = pushUnique(raw);
  else if (raw && Array.isArray(raw.extensions)) next = Object.assign({}, raw, { extensions: pushUnique(raw.extensions) });
  else if (raw && Array.isArray(raw.list)) next = Object.assign({}, raw, { list: pushUnique(raw.list) });
  else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    // { "id": scope } —— 新增一个 null-scope 条目
    next = Object.assign({ [UI_EXT_ID]: null }, raw);
  } else {
    next = { extensions: [UI_EXT_ID] };
  }

  fs.writeFileSync(listPath, JSON.stringify(next, null, 2) + '\n', 'utf8');
}

/* ── 安装 ────────────────────────────────────────────────────── */

function install(state, opts) {
  const src = resolveSource(state.root);

  if (!src) {
    console.error(red('  ✖'), '找不到展示页扩展源文件。');
    console.error(`     已尝试：${path.join(state.root, PAYLOAD_REL)}`);
    console.error(`              ${path.join(state.root, EXTS_DIR, UI_EXT_ID)}`);
    console.error('     请确认 install.js 与 .js-install/（或 .js/）在同一目录（即完整分发包已解压）。');
    process.exit(1);
  }

  if (opts.dryRun) {
    console.log(dim(`  [dry-run] 会把 ${src} 复制到 ${state.extDir}`));
    console.log(dim(`  [dry-run] 会把 "${UI_EXT_ID}" 写入 ${state.listPath}`));
    return;
  }

  // 复制扩展目录
  fs.mkdirSync(state.extDir, { recursive: true });
  let copied = 0;
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    if (!fs.statSync(from).isFile()) continue;
    fs.copyFileSync(from, path.join(state.extDir, name));
    copied++;
  }

  // 写入清单
  addToList(state);

  console.log(green('  ✓'), `已安装展示页扩展（${copied} 个文件）`);
  console.log(`    扩展目录 ${path.relative(process.cwd(), state.extDir) || state.extDir}`);
  console.log(`    已写入   ${path.relative(process.cwd(), state.listPath) || state.listPath}`);
}

/* ── 主流程 ──────────────────────────────────────────────────── */

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) { printHelp(); process.exit(0); }

  const root = opts.root ? path.resolve(opts.root) : __dirname;

  if (!fs.existsSync(root)) {
    console.error(red('  ✖'), `目录不存在：${root}`);
    process.exit(1);
  }

  const state = probe(root);

  console.log('');
  console.log(bold('  NavExt 内置展示页扩展 —— 安装'));
  console.log(dim('  ────────────────────────────────────────'));
  console.log(`  部署目录 ${root}`);
  console.log(`  扩展目录 ${dim(`${EXTS_DIR}/${UI_EXT_ID}`)}  ${state.dirExists ? green('已存在') : dim('不存在')}`);
  console.log(`  清单条目 ${dim(`${EXTS_DIR}/${LIST_FILE}`)}  ${
    state.listBroken ? red('解析失败') : (state.inList ? green('已包含') : dim('未包含'))
  }`);
  console.log('');

  /* 已安装 */
  if (state.dirExists && state.inList) {
    if (!opts.force) {
      console.log(green('  ✓'), '展示页扩展已安装，无需重复安装。');
      if (opts.dryRun) console.log(dim('    （--dry-run，未做任何改动）'));
      console.log('');
      process.exit(0);
    }
    console.log(yellow('  ⚠'), '已安装，但指定了 --force —— 将覆盖重装。');
    console.log('');
  }

  /* 半安装状态（有目录但清单没条目，或反之）—— 提示修复 */
  if (state.dirExists !== state.inList) {
    console.log(yellow('  ⚠'), '检测到安装不完整：');
    if (state.dirExists && !state.inList) {
      console.log(`     目录存在但清单里没有 ${UI_EXT_ID} —— 扩展不会被加载。`);
    } else {
      console.log(`     清单里有 ${UI_EXT_ID} 但没有扩展目录 —— 内核会警告扩展不存在。`);
    }
    console.log('     继续安装会自动修复。');
    console.log('');
  }

  /* 决定是否安装 */
  let want;

  if (opts.dryRun) {
    console.log('  [dry-run] 将要执行的操作：');
    console.log(`    1. 复制 .js/${UI_EXT_ID}/ 到部署目录`);
    console.log(`    2. 把 "${UI_EXT_ID}" 写入 ${EXTS_DIR}/${LIST_FILE}`);
    console.log('');
    console.log(dim('  去掉 --dry-run 即真正执行。'));
    console.log('');
    process.exit(0);
  }

  if (opts.yes) {
    want = true;
  } else if (opts.no) {
    want = false;
  } else if (!process.stdin.isTTY) {
    // 非交互环境（CI / 管道）：默认安装，保持「开箱可用」的默认体验
    console.log(dim('  非交互环境，按默认安装（可用 --no 跳过）。'));
    want = true;
  } else {
    const rl = createRl();
    console.log('  内置展示页会把站点里的 HTML 文件按目录渲染成卡片，带搜索与主题切换。');
    console.log('');
    console.log(dim('  不安装时：根路径 / 会服务站点根目录的 index.html；'));
    console.log(dim('            没有 index.html 则返回 0 字节空页面（其他扩展照常工作）。'));
    console.log('');
    want = await confirm(rl, '  是否安装内置展示页扩展？', true);
    rl.close();
    console.log('');
  }

  if (!want) {
    console.log(dim('  已跳过。展示页未安装。'));
    console.log(`  根路径 / 将${state.rootHasIndex ? '服务 index.html' : '返回空页面（0 字节）'}。`);
    console.log(dim('  需要时随时重新运行：node install.js'));
    console.log('');
    process.exit(0);
  }

  install(state, opts);
  console.log('');
  console.log('  接下来：');
  console.log(`    node server.dist.js        ${dim('# 启动服务')}`);
  console.log(`    或 node install.js --dry-run  ${dim('# 复查安装状态')}`);
  console.log('');
}

main().catch((err) => {
  console.error(red('  ✖'), err && err.message ? err.message : err);
  process.exit(1);
});
