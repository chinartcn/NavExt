#!/usr/bin/env node
'use strict';

/* ─── Node.js 版本检查 ─── */
(function checkNodeVersion() {
  var v = process.versions && process.versions.node;
  if (!v) return;
  var major = parseInt(String(v).split('.')[0], 10);
  if (isNaN(major) || major >= 14) return;

  var lines = [
    '',
    '  ✖ Node.js 版本过低：v' + v,
    '    本工具需要 Node.js 14 或更高版本',
    '',
    '    升级方式：',
    '      Termux:          pkg upgrade nodejs',
    '      Ubuntu/Debian:   sudo apt update && sudo apt install -y nodejs',
    '      macOS:           brew upgrade node',
    '      官网:            https://nodejs.org/',
    '',
  ];
  console.error(lines.join('\n'));
  process.exit(1);
})();


/**
 * build.js — 构建与打包工具
 *
 * 用法:
 *   node build.js                      只生成 server.dist.js
 *   node build.js --pack               打包成 app.tar.gz
 *   node build.js --pack --sfx         打包成自解压 app.sh
 *   node build.js -o <file>            自定义输出
 *   node build.js --no-extensions      打包时不带 .js/ 扩展
 *   node build.js --list               打包前列出会包含的文件
 *   node build.js --help
 *
 * 打包策略:
 *   白名单包含:  .html / .htm / .css / .js / .json / .md / 图片 / 字体 / 媒体
 *   自动排除:    server.js / build.js / cli.js / .navext.client.js
 *                node_modules / .git / 隐藏目录（除 .js）
 *                *.bak / *.orig / app.sh / app.tar.gz
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = __dirname;
const SERVER_SRC = path.join(ROOT, 'server.js');
const CLIENT_SRC = path.join(ROOT, '.navext.client.js');
const DIST_FILE = path.join(ROOT, 'server.dist.js');

const SFX_MARKER = '__SFX_ARCHIVE_BELOW__';

/* ═══════════════════════════════════════════════════════════════════════════
 *  参数解析
 * ═══════════════════════════════════════════════════════════════════════════ */

const opts = {
  pack: false,
  sfx: false,
  output: null,
  extensions: true,
  uiExt: true,        // v2.8.3：是否打包内置展示页扩展（.js/navext-ui）
  list: false,
};

for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--pack') opts.pack = true;
  else if (a === '--sfx') { opts.pack = true; opts.sfx = true; }
  else if (a === '--no-extensions') opts.extensions = false;
  else if (a === '--no-ui-ext') opts.uiExt = false;
  else if (a === '--with-ui-ext') opts.uiExt = true;
  else if (a === '--list') opts.list = true;
  else if (a === '-o' || a === '--output') opts.output = process.argv[++i];
  else if (a.startsWith('--output=')) opts.output = a.slice(9);
  else if (a === '-h' || a === '--help') {
    console.log(`
用法: node build.js [选项]

选项:
  --pack              打包成 tar.gz
  --sfx               打包成自解压 .sh（隐含 --pack）
  --no-extensions     打包时不带 .js/ 扩展
  --no-ui-ext         不打包内置展示页扩展（.js/navext-ui）
  --with-ui-ext       打包内置展示页扩展（默认）
  --list              打包前列出会包含的文件
  -o, --output <file> 输出文件路径
  -h, --help          显示帮助

示例:
  node build.js                      生成 server.dist.js
  node build.js --pack               生成 app.tar.gz
  node build.js --pack --sfx         生成 app.sh
  node build.js --sfx -o run.sh      自解压输出到 run.sh
  node build.js --pack --no-ui-ext   打包但不带内置展示页（根路径退化为 index.html）
`);
    process.exit(0);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  步骤 1：合并 server.dist.js
 * ═══════════════════════════════════════════════════════════════════════════ */

function readOrExit(p, label) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (err) {
    console.error(`✖ 无法读取${label}：${p}`);
    console.error(`  ${err.message}`);
    process.exit(1);
  }
}

function buildDist() {
  const serverSrc = readOrExit(SERVER_SRC, ' server.js');
  const clientSrc = readOrExit(CLIENT_SRC, '客户端库');

  const START = '/* __NAVEXT_LOADER_START__ */';
  const END = '/* __NAVEXT_LOADER_END__ */';

  const s = serverSrc.indexOf(START);
  const e = serverSrc.indexOf(END);

  if (s === -1 || e === -1 || e < s) {
    console.error('✖ 在 server.js 中找不到标记块');
    if (s === -1) console.error('  → 缺 START 标记');
    if (e === -1) console.error('  → 缺 END 标记');
    process.exit(1);
  }

  const header = [
    '// ──────────────────────────────────────────────────────────────',
    '//  单文件版本：客户端库已内联，无需外部 .navext.client.js。',
    '//  修改请回到 server.js + .navext.client.js，再运行 build.js。',
    `//  生成时间：${new Date().toISOString()}`,
    '// ──────────────────────────────────────────────────────────────',
    '',
  ].join('\n');

  const injected = [
    header,
    '// 客户端库（内联）',
    'const NAVEXT_CLIENT_INLINE = ' + JSON.stringify(clientSrc) + ';',
    '',
    'function loadNavExtClient() {',
    '  return NAVEXT_CLIENT_INLINE;',
    '}',
  ].join('\n');

  const out = serverSrc.slice(0, s) + injected + serverSrc.slice(e + END.length);

  try {
    const stripped = out.replace(/^#![^\n]*\n/, '\n');
    new vm.Script(stripped, { filename: 'server.dist.js' });
  } catch (err) {
    console.error('✖ 生成的代码有语法错误，已放弃输出：');
    console.error(`  ${err.message}`);
    process.exit(1);
  }

  fs.writeFileSync(DIST_FILE, out, 'utf8');

  const sizeKB = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
  return { path: DIST_FILE, sizeKB, source: out };
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  步骤 2：文件过滤规则
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 顶层排除的文件（精确名匹配） */
const SKIP_FILES = new Set([
  'server.js',            // 源文件，发布版用 dist
  '.navext.client.js',    // 已内联进 dist
  'build.js',             // 构建脚本
  'cli.js',               // 扩展管理工具
  'server.dist.js',       // 重新生成
  'start.sh',             // 重新生成
  'app.sh',               // 打包产物
  'app.tar.gz',           // 打包产物
  'package-lock.json',    // 无依赖，不用
  '.DS_Store',
  'Thumbs.db',
  // 注意：install.js 不在此列表 —— 它是「部署后按需安装展示页」的
  // 入口脚本，必须随发布包一起分发（见 v2.8.3）。
]);

/** 顶层排除的目录（精确名匹配） */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '.tmp',
  '.cache',
  '__pycache__',
  '.idea',
  '.vscode',
  'dist-test',
]);

/**
 * 内置展示页扩展的目录名（v2.8.3）。
 *
 * 它是唯一一个「内核不再内置、改为可选扩展」的构件：
 * 不打包时，根路径 / 会退化为服务 index.html，找不到则返回 0 字节空页面。
 * 用 --no-ui-ext 排除，用 install.js 在部署后按需安装。
 */
const UI_EXT_DIR_NAME = 'navext-ui';

/**
 * 「展示页安装载荷」目录名（v2.8.3）。
 *
 * 用 --no-ui-ext 打包时，.js/navext-ui/ 被排除在扩展加载之外，
 * 但 install.js 仍需要一份源文件才能安装。于是把它放到这个临时目录里：
 * 内核只扫描 .js/，不会把它当成已加载的扩展（不会出现在清单里），
 * 但 install.js 能找到它并复制到 .js/navext-ui/。
 */
const UI_INSTALL_PAYLOAD_DIR = '.js-install';

/** collectDir 时是否跳过了展示页扩展（用于打包后提示） */
let skippedUiExt = false;

/** 备份 / 临时文件模式 */
const BACKUP_PATTERNS = [
  /\.bak(\..*)?$/i,
  /\.orig$/i,
  /\.swp$/i,
  /\.swo$/i,
  /~$/,
  /^\.#/,
  /\.tmp$/i,
];

/** 允许打包的扩展名 */
const ALLOWED_EXT = new Set([
  // 网页
  '.html', '.htm',
  // 样式与脚本
  '.css', '.js', '.mjs', '.cjs',
  // 数据
  '.json', '.xml', '.txt', '.csv', '.map',
  // 文档
  '.md', '.markdown',
  // 图片
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.bmp',
  // 字体
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  // 媒体
  '.mp3', '.wav', '.ogg', '.mp4', '.webm',
  // 其他
  '.pdf', '.wasm', '.yaml', '.yml',
]);

/** 无扩展名但值得带上 */
const ALLOWED_NOEXT = new Set([
  'LICENSE', 'LICENCE', 'CHANGELOG', 'CHANGES', 'AUTHORS', 'NOTICE',
]);

function isBackupFile(name) {
  for (const p of BACKUP_PATTERNS) if (p.test(name)) return true;
  return false;
}

function shouldIncludeFile(name) {
  if (SKIP_FILES.has(name)) return false;
  if (isBackupFile(name)) return false;
  if (name.startsWith('.')) return false;

  const ext = path.extname(name).toLowerCase();
  if (ALLOWED_EXT.has(ext)) return true;

  if (!ext && ALLOWED_NOEXT.has(name)) return true;

  return false;
}

function shouldIncludeDir(name, depth) {
  if (SKIP_DIRS.has(name)) return false;

  // 隐藏目录：只放行根目录下的 .js 扩展目录
  if (name.startsWith('.')) {
    if (depth === 0 && name === '.js') return true;
    return false;
  }

  // 备份目录
  if (isBackupFile(name)) return false;

  return true;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  步骤 3：递归收集项目内容
 * ═══════════════════════════════════════════════════════════════════════════ */

const stats = {
  html: 0,
  css: 0,
  js: 0,
  images: 0,
  fonts: 0,
  other: 0,
  ext: 0,
};

function bumpStat(name, inExt) {
  const ext = path.extname(name).toLowerCase();
  if (inExt) { stats.ext++; return; }
  if (ext === '.html' || ext === '.htm') stats.html++;
  else if (ext === '.css') stats.css++;
  else if (ext === '.js' || ext === '.mjs' || ext === '.cjs') stats.js++;
  else if (/\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i.test(name)) stats.images++;
  else if (/\.(woff2?|ttf|otf|eot)$/i.test(name)) stats.fonts++;
  else stats.other++;
}

/**
 * 递归收集。
 * @param {string} absDir 当前遍历的绝对目录
 * @param {string} prefix 相对于打包根的路径前缀（'' 表示顶层）
 * @param {Array}  out    输出数组
 * @param {number} depth  递归深度（0 是根）
 * @param {string} extRoot 扩展目录名（如 '.js'），用于统计和放行
 */
function collectDir(absDir, prefix, out, depth, extRoot) {
  if (depth > 12) return;

  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const ent of entries) {
    const name = ent.name;
    const abs = path.join(absDir, name);
    const rel = prefix ? prefix + '/' + name : name;

    if (ent.isDirectory()) {
      // 扩展目录：单独放行（即使 --no-extensions 也会处理默认情况）
      const isExtDir = (depth === 0 && name === extRoot);
      if (!isExtDir && !shouldIncludeDir(name, depth)) continue;
      if (isExtDir && !opts.extensions) continue;

      // v2.8.3：扩展目录下的一级子目录就是各个扩展，--no-ui-ext 时跳过展示页扩展
      const isExtChild = (depth === 1 && prefix === extRoot);
      if (isExtChild && !opts.uiExt && name === UI_EXT_DIR_NAME) {
        skippedUiExt = true;
        continue;
      }

      out.push({ name: rel + '/', data: Buffer.alloc(0), dir: true });
      collectDir(abs, rel, out, depth + 1, extRoot);
      continue;
    }

    if (!ent.isFile()) continue;

    const inExt = prefix === extRoot || prefix.startsWith(extRoot + '/');
    if (inExt && !opts.extensions) continue;

    if (!inExt && !shouldIncludeFile(name)) continue;

    try {
      const data = fs.readFileSync(abs);
      out.push({ name: rel, data });
      bumpStat(name, inExt);
    } catch {}
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  步骤 4：组装打包文件列表
 * ═══════════════════════════════════════════════════════════════════════════ */

const START_SH_CONTENT = `#!/bin/sh
# 一键启动脚本
# 用法: ./start.sh [--port 8080] [其他 node server.dist.js 参数]
cd "$(dirname "$0")"

# 检查 Node.js
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  ✖ 找不到 Node.js，无法启动服务"
  echo "    请先安装 Node.js 14 或更高版本："
  echo "    - Termux:        pkg install nodejs"
  echo "    - Ubuntu/Debian: sudo apt install nodejs"
  echo "    - macOS:         brew install node"
  echo "    - 官网:          https://nodejs.org/"
  echo ""
  exit 1
fi

exec node server.dist.js "$@"
`;

function collectPackFiles(distSource) {
  const files = [];
  const extRoot = '.js';

  // 1) 核心：server.dist.js
  files.push({
    name: 'server.dist.js',
    data: Buffer.from(distSource, 'utf8'),
  });

  // 2) 启动脚本
  files.push({
    name: 'start.sh',
    data: Buffer.from(START_SH_CONTENT, 'utf8'),
    mode: 0o755,
  });

  // 3) 递归收集项目内容（HTML / 资源 / 扩展 / 配置）
  //    注意：此时源目录里的 .js/navext-ui/ 可能已被 --no-ui-ext 跳过，
  //    但 install.js 需要单独补上一份「可安装的展示页源」才能工作。
  collectDir(ROOT, '', files, 0, extRoot);

  // 3.5) 保留 install.js（发布包里必须存在，用于部署后补装展示页）
  //      正常情况 collectDir 已收录；这里只是显式兜底，避免将来被误加进 SKIP_FILES。
  if (!files.some((f) => f.name === 'install.js')) {
    try {
      files.push({ name: 'install.js', data: fs.readFileSync(path.join(ROOT, 'install.js')) });
    } catch {}
  }

  // 3.6) --no-ui-ext 时，把展示页扩展的源文件收进 install 用的载荷目录
  //      `.js-install/navext-ui/`。它不参与扩展加载（不在 .js/ 下），
  //      仅供 install.js 在部署后复制到 .js/navext-ui/。
  if (skippedUiExt) {
    collectDir(
      path.join(ROOT, extRoot, UI_EXT_DIR_NAME),
      path.join(UI_INSTALL_PAYLOAD_DIR, UI_EXT_DIR_NAME),
      files, 0, path.join(UI_INSTALL_PAYLOAD_DIR, UI_EXT_DIR_NAME)
    );
  }

  // 4) --no-ui-ext：从 js.list.json 里剔除展示页扩展
  //    否则部署后内核会警告「清单里的扩展不存在」。
  if (skippedUiExt) pruneUiExtFromList(files, extRoot);

  return files;
}

/**
 * 把展示页扩展从打包后的 .js/js.list.json 中移除（v2.8.3）。
 *
 * js.list.json 支持四种形态（数组 / {extensions:[]} / {list:[]} / {id:scope}），
 * 这里只做最小侵入的改写：只动数组元素，不改变整体结构。
 */
function pruneUiExtFromList(files, extRoot) {
  const listName = extRoot + '/js.list.json';
  const f = files.find((x) => x.name === listName);
  if (!f) return;

  try {
    const raw = JSON.parse(f.data.toString('utf8'));

    const stripArr = (arr) => arr.filter((x) => {
      if (typeof x === 'string') return x !== UI_EXT_DIR_NAME;
      if (x && typeof x === 'object') return !(UI_EXT_DIR_NAME in x);
      return true;
    });

    let next;
    if (Array.isArray(raw)) next = stripArr(raw);
    else if (raw && Array.isArray(raw.extensions)) next = Object.assign({}, raw, { extensions: stripArr(raw.extensions) });
    else if (raw && Array.isArray(raw.list)) next = Object.assign({}, raw, { list: stripArr(raw.list) });
    else next = null;

    if (next === null) {
      console.warn(`  ⚠ 无法识别 ${listName} 的结构，未剔除 ${UI_EXT_DIR_NAME}`);
      return;
    }

    f.data = Buffer.from(JSON.stringify(next, null, 2), 'utf8');
  } catch (err) {
    console.warn(`  ⚠ 解析 ${listName} 失败（${err.message}），未剔除 ${UI_EXT_DIR_NAME}`);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  步骤 5：手写 tar
 * ═══════════════════════════════════════════════════════════════════════════ */

function tarHeader(name, size, entryOpts) {
  entryOpts = entryOpts || {};
  const buf = Buffer.alloc(512);
  const typeflag = entryOpts.dir ? '5' : '0';
  const mode = entryOpts.dir ? 0o755 : (entryOpts.mode || 0o644);
  const mtime = Math.floor((entryOpts.mtime || Date.now()) / 1000);

  if (Buffer.byteLength(name, 'utf8') > 100) {
    throw new Error(`tar 路径过长（>100 字节）：${name}`);
  }

  buf.write(name, 0, 'utf8');
  buf.write(mode.toString(8).padStart(7, '0') + '\0', 100, 'ascii');
  buf.write('0000000\0', 108, 'ascii');
  buf.write('0000000\0', 116, 'ascii');
  buf.write(size.toString(8).padStart(11, '0') + '\0', 124, 'ascii');
  buf.write(mtime.toString(8).padStart(11, '0') + '\0', 136, 'ascii');
  buf.fill(0x20, 148, 156);   // checksum 占位：8 个空格
  buf.write(typeflag, 156, 'ascii');
  buf.write('ustar\0', 257, 'ascii');
  buf.write('00', 263, 'ascii');

  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');

  return buf;
}

function makeTar(entries) {
  const blocks = [];

  for (const e of entries) {
    const name = 'app/' + e.name;
    blocks.push(tarHeader(name, e.data.length, e));
    if (!e.dir && e.data.length > 0) {
      blocks.push(e.data);
      const pad = (512 - (e.data.length % 512)) % 512;
      if (pad > 0) blocks.push(Buffer.alloc(pad));
    }
  }

  blocks.push(Buffer.alloc(1024));   // tar 结束：两个零块
  return Buffer.concat(blocks);
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  步骤 6：自解压脚本
 * ═══════════════════════════════════════════════════════════════════════════ */

function makeSelfExtract(tgzBuffer, appName) {
  const MARKER = SFX_MARKER;   // JS 变量，插值后成字面字符串
  const b64 = tgzBuffer.toString('base64');
  const lines = [];
  for (let i = 0; i < b64.length; i += 76) lines.push(b64.slice(i, i + 76));
  const b64Wrapped = lines.join('\n');

  return `#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════════
#  ${appName}
#  自解压单文件：运行即可启动服务
# ═══════════════════════════════════════════════════════════════════════════
#
#  用法:
#    ./${appName}                     解压到临时目录并启动
#    ./${appName} --keep ./myapp      解压到指定目录并启动（保留文件）
#    ./${appName} --extract ./myapp   只解压，不启动
#    ./${appName} --port 8080         传给 node 的其他参数
#
#  环境要求: Node.js 14+, tar, gzip, base64
# ═══════════════════════════════════════════════════════════════════════════

set -e

MARKER="${MARKER}"

KEEP_DIR=""
EXTRACT_ONLY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --keep)    KEEP_DIR="$2"; shift 2 ;;
    --extract) EXTRACT_ONLY=1; KEEP_DIR="$2"; shift 2 ;;
    *) break ;;
  esac
done

if [ -n "$KEEP_DIR" ]; then
  TARGET="$KEEP_DIR"
  mkdir -p "$TARGET"
  CLEANUP=0
else
  TARGET=$(mktemp -d)
  CLEANUP=1
fi

LINE=$(grep -an "^$MARKER\$" "$0" | head -1 | cut -d: -f1)
if [ -z "$LINE" ]; then
  echo "✖ 找不到归档标记，文件可能损坏" >&2
  exit 1
fi
START=$((LINE + 1))

if ! tail -n +$START "$0" | base64 -d 2>/dev/null | gunzip 2>/dev/null | tar -xf - -C "$TARGET" 2>/dev/null; then
  echo "✖ 解压失败。请确认已安装 base64, gzip, tar" >&2
  [ "$CLEANUP" = "1" ] && rm -rf "$TARGET"
  exit 1
fi

if [ "$EXTRACT_ONLY" = "1" ]; then
  echo "✓ 已解压到 $TARGET"
  echo "  运行方式: cd $TARGET/app && ./start.sh"
  exit 0
fi

cd "$TARGET/app"

if [ "$CLEANUP" = "1" ]; then
  trap 'rm -rf "$TARGET"' EXIT INT TERM
fi

# 检查 Node.js
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  ✖ 找不到 Node.js，无法启动服务"
  echo "    请先安装 Node.js 14 或更高版本："
  echo "    - Termux:        pkg install nodejs"
  echo "    - Ubuntu/Debian: sudo apt install nodejs"
  echo "    - macOS:         brew install node"
  echo "    - 官网:          https://nodejs.org/"
  echo ""
  exit 1
fi

exec node server.dist.js "$@"

exit 0
${MARKER}
${b64Wrapped}
`;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  主流程
 * ═══════════════════════════════════════════════════════════════════════════ */

console.log('');

/* ─── 步骤 1：构建 dist ──────────────────────────────────────────────── */

process.stdout.write('  → 合并 server.dist.js ... ');
const dist = buildDist();
console.log(`✓ (${dist.sizeKB} KB)`);

if (!opts.pack) {
  console.log('');
  console.log('  ✓ 已完成');
  console.log(`    输出：${path.relative(process.cwd(), dist.path)}`);
  console.log('');
  console.log('  分发时只需这一个文件：');
  console.log('    node server.dist.js');
  console.log('');
  console.log('  提示：用 --pack 打包成 tar.gz，或 --pack --sfx 生成自解压 .sh');
  console.log('');
  process.exit(0);
}

/* ─── 步骤 2：收集文件 ───────────────────────────────────────────────── */

process.stdout.write('  → 收集项目文件 ... ');
const files = collectPackFiles(dist.source);
const totalBytes = files.reduce((s, f) => s + f.data.length, 0);
console.log(`✓ (${files.length} 项, ${(totalBytes / 1024).toFixed(1)} KB)`);

/* ─── 步骤 3：打印清单（可选） ───────────────────────────────────────── */

if (opts.list) {
  console.log('');
  console.log('  打包内容:');
  const sorted = files.slice().sort((a, b) => a.name.localeCompare(b.name));
  for (const f of sorted) {
    const size = f.dir ? '' : ` (${(f.data.length / 1024).toFixed(1)} KB)`;
    console.log(`    ${f.name}${size}`);
  }
  console.log('');
}

/* ─── 步骤 4：tar + gzip ─────────────────────────────────────────────── */

process.stdout.write('  → 生成 tar 归档 ... ');
const tarBuf = makeTar(files);
console.log(`✓ (${(tarBuf.length / 1024).toFixed(1)} KB)`);

process.stdout.write('  → gzip 压缩 ... ');
const tgz = zlib.gzipSync(tarBuf, { level: 9 });
const ratio = (100 * tgz.length / tarBuf.length).toFixed(0);
console.log(`✓ (${(tgz.length / 1024).toFixed(1)} KB, ${ratio}%)`);

/* ─── 步骤 5：输出 ──────────────────────────────────────────────────── */

let outFile;
let finalBuf;

if (opts.sfx) {
  outFile = opts.output
    ? path.resolve(process.cwd(), opts.output)
    : path.join(ROOT, 'app.sh');
  const appName = path.basename(outFile);

  process.stdout.write('  → 生成自解压脚本 ... ');
  const shSrc = makeSelfExtract(tgz, appName);
  finalBuf = Buffer.from(shSrc, 'utf8');
  console.log(`✓ (${(finalBuf.length / 1024).toFixed(1)} KB)`);

  fs.writeFileSync(outFile, finalBuf, { mode: 0o755 });
} else {
  outFile = opts.output
    ? path.resolve(process.cwd(), opts.output)
    : path.join(ROOT, 'app.tar.gz');
  finalBuf = tgz;
  fs.writeFileSync(outFile, finalBuf, { mode: 0o644 });
}

/* ─── 完成信息 ──────────────────────────────────────────────────────── */

console.log('');
console.log('  ✓ 打包完成');
console.log(`    输出：${path.relative(process.cwd(), outFile)}`);
console.log(`    大小：${(finalBuf.length / 1024).toFixed(1)} KB`);
console.log('');

console.log('  内容统计:');
if (stats.html)   console.log(`    HTML        ${stats.html} 个`);
if (stats.css)    console.log(`    CSS         ${stats.css} 个`);
if (stats.js)     console.log(`    JS          ${stats.js} 个`);
if (stats.images) console.log(`    图片        ${stats.images} 个`);
if (stats.fonts)  console.log(`    字体        ${stats.fonts} 个`);
if (stats.other)  console.log(`    其他        ${stats.other} 个`);
if (stats.ext)    console.log(`    扩展文件    ${stats.ext} 个`);
console.log('');

// v2.8.3：内置展示页是可选项 —— 排除了就必须说清楚后果
if (skippedUiExt) {
  console.log(`  ⚠ 未包含内置展示页扩展（.js/${UI_EXT_DIR_NAME}）`);
  console.log('     部署后根路径 / 会服务站点根目录的 index.html；');
  console.log('     若没有 index.html，则返回 200 + 0 字节空页面（其他扩展照常工作）。');
  console.log('     需要展示页时，在部署目录执行：node install.js');
  console.log('');
}

if (opts.sfx) {
  console.log('  使用方式：');
  console.log(`    chmod +x ${path.basename(outFile)}`);
  console.log(`    ./${path.basename(outFile)}                   # 解压并启动`);
  console.log(`    ./${path.basename(outFile)} --keep ./myapp    # 保留到指定目录`);
  console.log(`    ./${path.basename(outFile)} --extract ./myapp # 只解压`);
} else {
  console.log('  使用方式：');
  console.log(`    tar xzf ${path.basename(outFile)}`);
  console.log('    cd app && ./start.sh');
}
console.log('');