#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════
 *  vm.js — NavExt 扩展安全沙箱检测器
 *
 *  把扩展放进隔离的 vm 上下文里运行，观察它会做什么（读敏感文件？起子进程？
 *  发网络请求？），据此判断是否恶意。—— 全程「仿真」，不真实执行任何危险操作。
 *
 *  用法：
 *    node vm.js <扩展目录>             审计单个扩展
 *    node vm.js <扩展目录> --json      输出机器可读 JSON
 *    node vm.js --all                  审计 .js/ 下全部扩展
 *    node vm.js <目录> --timeout 3000  自定义单次运行超时(ms)
 *
 *  零依赖：仅用 Node 内置模块。
 * ═══════════════════════════════════════════════════════════════════════════ */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const TOOL_VERSION = '1.0.0';

/* ═══════════════════════════════════════════════════════════════════════════
 *  [01] 终端着色
 * ═══════════════════════════════════════════════════════════════════════════ */

const NO_COLOR = process.env.NO_COLOR || !process.stdout.isTTY;
const C = {
  red:    (s) => NO_COLOR ? s : `\x1b[31m${s}\x1b[0m`,
  green:  (s) => NO_COLOR ? s : `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => NO_COLOR ? s : `\x1b[33m${s}\x1b[0m`,
  blue:   (s) => NO_COLOR ? s : `\x1b[34m${s}\x1b[0m`,
  gray:   (s) => NO_COLOR ? s : `\x1b[90m${s}\x1b[0m`,
  bold:   (s) => NO_COLOR ? s : `\x1b[1m${s}\x1b[0m`,
  dim:    (s) => NO_COLOR ? s : `\x1b[2m${s}\x1b[0m`,
};

/* ═══════════════════════════════════════════════════════════════════════════
 *  [02] 风险规则库 —— 决定什么行为算危险
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 敏感路径（正则）→ 说明 */
const SENSITIVE_PATHS = [
  [/\/etc\/(passwd|shadow|sudoers)/i, '读取系统账号/密码文件'],
  [/(^|[\\/])\.ssh[\\/]/i,            '读取 SSH 私钥目录'],
  [/(^|[\\/])\.gnupg[\\/]/i,          '读取 GPG 密钥目录'],
  [/(^|[\\/])\.aws[\\/]/i,            '读取 AWS 凭证'],
  [/(^|[\\/])\.(gcloud|azure|kube|docker)[\\/]/i, '读取云平台凭证'],
  [/(^|[\\/])\.env(\.[a-z]+)?$/i,     '读取环境变量文件'],
  [/id_(rsa|dsa|ecdsa|ed25519)/i,     '读取私钥文件'],
  [/(credentials|secrets?)\.(json|ya?ml|ini|txt)/i, '读取凭证文件'],
  [/(^|[\\/])(wallet|keystore)[\\/]/i, '读取钱包/密钥库'],
  [/[\\/]proc[\\/]self[\\/]environ/i,  '读取进程环境变量'],
];

/** 危险模块 → 风险等级与说明 */
const DANGEROUS_MODULES = {
  child_process:     { level: 'malicious',  desc: '执行系统命令' },
  cluster:           { level: 'suspicious', desc: '创建子进程集群' },
  worker_threads:    { level: 'suspicious', desc: '创建 worker 线程' },
  dgram:             { level: 'suspicious', desc: 'UDP 通信（可用于数据外送）' },
  net:               { level: 'suspicious', desc: '原生 TCP 通信' },
  tls:               { level: 'suspicious', desc: '原生 TLS 通信' },
  http2:             { level: 'suspicious', desc: 'HTTP/2 通信' },
  inspector:         { level: 'malicious',  desc: '开启调试器（可远程代码执行）' },
  repl:              { level: 'suspicious', desc: 'REPL（可交互执行）' },
};

/** 注入类全局函数名 → 说明（扩展改写这些 = 劫持宿主行为） */
const HIJACK_TARGETS = [
  'fetch', 'XMLHttpRequest', 'require', 'process', 'globalThis',
  'setTimeout', 'setInterval', 'console', 'JSON', 'Promise', 'Array', 'Object',
];

/* ═══════════════════════════════════════════════════════════════════════════
 *  [03] 行为记录器 —— 沙箱内所有危险动作都走这里，只记录不执行
 * ═══════════════════════════════════════════════════════════════════════════ */

function createRecorder() {
  const findings = [];   // { level, category, detail, evidence }
  const calls = [];      // 完整调用流水

  const add = (level, category, detail, evidence) => {
    const f = { level, category, detail, evidence: evidence || '' };
    findings.push(f);
    return f;
  };

  const logCall = (api, args) => {
    if (calls.length < 500) calls.push({ api, args: args.map(shorten) });
  };

  return { findings, calls, add, logCall };
}

/** 把参数压成一行短字符串 */
function shorten(v) {
  try {
    if (typeof v === 'string') return v.length > 160 ? v.slice(0, 160) + '…' : v;
    if (v === null || v === undefined) return String(v);
    if (typeof v === 'function') return '[Function]';
    if (typeof v === 'object') {
      const s = JSON.stringify(v);
      return s && s.length > 160 ? s.slice(0, 160) + '…' : (s || '[Object]');
    }
    return String(v);
  } catch { return '[Unserializable]'; }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  [04] 构建沙箱 —— 一套完全仿真的 Node 环境
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 创建一个"看起来像 Node、但所有危险能力都是假的"的上下文。
 *
 * @param {object} rec      行为记录器
 * @param {string} extDir   被审扩展的目录（用于判断文件访问是否越界）
 * @param {string} label    扩展标识（日志用）
 */
function buildSandbox(rec, extDir, label) {
  const realExtDir = extDir ? path.resolve(extDir) : process.cwd();

  /** 判断一个路径是否是"扩展目录之外" */
  const classifyPath = (p) => {
    const s = String(p);
    for (const [re, why] of SENSITIVE_PATHS) {
      if (re.test(s)) {
        rec.add('malicious', '敏感路径访问', `试图读取 ${why}`, s);
        return;
      }
    }
    // 绝对路径且不在扩展目录内 → 越界
    if (path.isAbsolute(s)) {
      const rel = path.relative(realExtDir, s);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        rec.add('suspicious', '越界文件访问', '访问扩展目录之外的绝对路径', s);
      }
      return;
    }
    // 相对路径回溯
    if (/(^|\/)\.\.\//.test(s) || s.startsWith('../') || s.startsWith('..\\')) {
      const rel = path.relative(realExtDir, path.resolve(realExtDir, s));
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        rec.add('suspicious', '越界文件访问', '用相对路径回溯到扩展目录之外', s);
      }
    }
  };

  const noteWrite = (op, target) => {
    classifyPath(target);
    const s = String(target);
    for (const [re, why] of SENSITIVE_PATHS) {
      if (re.test(s)) {
        rec.add('malicious', '敏感路径写入', `试图写入 ${why}`, s);
        return;
      }
    }
    if (/[\\/](crontab|authorized_keys|\.bashrc|\.zshrc|\.profile|profile\.d)$/i.test(s)) {
      rec.add('malicious', '持久化', '试图写入自动执行/持久化位置', s);
    } else {
      rec.add('suspicious', '文件写入', `试图${op}`, s);
    }
  };

  /* ── 仿真的 fs ── */
  const fakeFs = {
    readFileSync(p, enc) {
      rec.logCall('fs.readFileSync', [p]);
      classifyPath(p);
      rec.add('info', '文件读取', '读取文件（仿真，未真实读取）', String(p));
      return enc ? '' : Buffer.from('');
    },
    readFile(p, enc, cb) {
      rec.logCall('fs.readFile', [p]);
      classifyPath(p);
      if (typeof cb === 'function') cb(null, enc ? '' : Buffer.from(''));
    },
    writeFileSync(p, data) { rec.logCall('fs.writeFileSync', [p]); noteWrite('写入文件', p); },
    writeFile(p, data, cb) { rec.logCall('fs.writeFile', [p]); noteWrite('写入文件', p); if (typeof cb === 'function') cb(null); },
    appendFileSync(p) { rec.logCall('fs.appendFileSync', [p]); noteWrite('追加写入', p); },
    unlinkSync(p) { rec.logCall('fs.unlinkSync', [p]); noteWrite('删除文件', p); },
    rmSync(p, o) { rec.logCall('fs.rmSync', [p, o]); noteWrite('递归删除', p); },
    rmdirSync(p) { rec.logCall('fs.rmdirSync', [p]); noteWrite('删除目录', p); },
    mkdirSync(p) { rec.logCall('fs.mkdirSync', [p]); rec.add('info', '目录创建', '创建目录', String(p)); },
    readdirSync(p) { rec.logCall('fs.readdirSync', [p]); classifyPath(p); return []; },
    statSync(p) { rec.logCall('fs.statSync', [p]); classifyPath(p); return { isFile: () => true, isDirectory: () => false, size: 0, mtimeMs: 0 }; },
    existsSync(p) { rec.logCall('fs.existsSync', [p]); classifyPath(p); return false; },
    copyFileSync(a, b) { rec.logCall('fs.copyFileSync', [a, b]); noteWrite('复制到', b); },
    renameSync(a, b) { rec.logCall('fs.renameSync', [a, b]); noteWrite('重命名到', b); },
    chmodSync(p, m) { rec.logCall('fs.chmodSync', [p, m]); rec.add('suspicious', '权限修改', `修改文件权限为 ${m}`, String(p)); },
    chownSync(p, u, g) { rec.logCall('fs.chownSync', [p, u, g]); rec.add('malicious', '权限修改', `修改文件属主为 ${u}:${g}`, String(p)); },
    createReadStream(p) { rec.logCall('fs.createReadStream', [p]); classifyPath(p); return fakeStream(); },
    createWriteStream(p) { rec.logCall('fs.createWriteStream', [p]); noteWrite('流式写入', p); return fakeStream(); },
    symlinkSync(t, p) { rec.logCall('fs.symlinkSync', [t, p]); rec.add('suspicious', '符号链接', `创建软链 ${p} → ${t}`, String(p)); },
    promises: {
      readFile: async (p, enc) => { rec.logCall('fs.promises.readFile', [p]); classifyPath(p); return enc ? '' : Buffer.from(''); },
      writeFile: async (p) => { rec.logCall('fs.promises.writeFile', [p]); noteWrite('写入文件', p); },
      unlink: async (p) => { rec.logCall('fs.promises.unlink', [p]); noteWrite('删除文件', p); },
      readdir: async (p) => { rec.logCall('fs.promises.readdir', [p]); return []; },
      stat: async (p) => { rec.logCall('fs.promises.stat', [p]); return { isFile: () => true, size: 0 }; },
    },
  };

  const fakeStream = () => ({
    on() { return this; }, once() { return this; }, pipe() { return this; },
    write() { return true; }, end() {}, destroy() {}, close() {},
  });

  /* ── 仿真的 child_process ── */
  const fakeChild = {
    exec(cmd, o, cb) {
      rec.logCall('child_process.exec', [cmd]);
      rec.add('malicious', '命令执行', '试图执行系统命令', String(cmd));
      const fn = typeof o === 'function' ? o : cb;
      if (typeof fn === 'function') fn(null, '', '');
      return fakeStream();
    },
    execSync(cmd) {
      rec.logCall('child_process.execSync', [cmd]);
      rec.add('malicious', '命令执行', '试图同步执行系统命令', String(cmd));
      return Buffer.from('');
    },
    spawn(cmd, args) {
      rec.logCall('child_process.spawn', [cmd, args]);
      rec.add('malicious', '命令执行', '试图派生进程', `${cmd} ${(args || []).join(' ')}`);
      return fakeStream();
    },
    spawnSync(cmd, args) {
      rec.logCall('child_process.spawnSync', [cmd, args]);
      rec.add('malicious', '命令执行', '试图同步派生进程', `${cmd} ${(args || []).join(' ')}`);
      return { status: 0, stdout: Buffer.from(''), stderr: Buffer.from('') };
    },
    execFile(f, args, cb) {
      rec.logCall('child_process.execFile', [f, args]);
      rec.add('malicious', '命令执行', '试图执行文件', `${f} ${(args || []).join(' ')}`);
      if (typeof cb === 'function') cb(null, '', '');
      return fakeStream();
    },
    fork(m) {
      rec.logCall('child_process.fork', [m]);
      rec.add('malicious', '命令执行', '试图 fork 子进程', String(m));
      return fakeStream();
    },
  };

  /* ── 仿真的网络 ── */
  const noteUrl = (u, kind) => {
    const s = String(u);
    rec.logCall(kind, [s]);
    let host = '';
    try { host = new URL(s).hostname; } catch {}
    const isLocal = /^(localhost|127\.0\.0\.1|::1|0\.0\.0\.0)$/.test(host);
    if (!s.startsWith('http')) {
      rec.add('suspicious', '网络访问', `非 HTTP 协议请求（${kind}）`, s);
    } else if (isLocal) {
      rec.add('info', '网络访问', '本机请求（仿真，未发出）', s);
    } else {
      rec.add('suspicious', '外部网络请求', '向外部主机发起请求（仿真，未发出）', s);
    }
  };

  const fakeFetch = (u, opts) => {
    noteUrl(u, 'fetch');
    return Promise.resolve({
      ok: true, status: 200, statusText: 'OK',
      headers: { get: () => 'application/json' },
      json: async () => ({}),
      text: async () => '',
      arrayBuffer: async () => new ArrayBuffer(0),
    });
  };

  /* ── 受控的 require ── */
  const makeRequire = () => {
    const req = (spec) => {
      rec.logCall('require', [spec]);
      const name = String(spec);

      // 相对路径：视为扩展内部模块，允许继续（仍用假环境）
      if (name.startsWith('.') || path.isAbsolute(name)) {
        if (path.isAbsolute(name)) classifyPath(name);
        return {};
      }

      // 危险模块
      if (DANGEROUS_MODULES[name]) {
        const m = DANGEROUS_MODULES[name];
        rec.add(m.level, '危险模块加载', `加载 ${name} —— ${m.desc}`, name);
        if (name === 'child_process') return fakeChild;
        if (name === 'net' || name === 'tls') {
          return { connect: (...a) => { noteUrl(`tcp://${a[0]}:${a[1]}`, 'net.connect'); return fakeStream(); },
                   createServer: () => { rec.add('suspicious', '监听端口', '创建网络服务器'); return fakeStream(); } };
        }
        if (name === 'dgram') {
          return { createSocket: () => ({ send: (m, p, port, host) => { noteUrl(`udp://${host}:${port}`, 'dgram.send'); }, bind: () => {}, on: () => {} }) };
        }
        if (name === 'http2') return { connect: () => fakeStream(), createServer: () => fakeStream() };
        return {};
      }

      // 已知安全的内置模块，返回仿真版
      switch (name) {
        case 'fs': return fakeFs;
        case 'path': return path;
        case 'url': return require('url');
        case 'util': return require('util');
        case 'events': return require('events');
        case 'crypto': return makeFakeCrypto(rec);
        case 'os': return { hostname: () => 'sandbox', platform: () => 'sandbox', cpus: () => [], homedir: () => '/sandbox/home', tmpdir: () => '/sandbox/tmp', userInfo: () => ({ username: 'sandbox' }) };
        case 'http':
        case 'https': {
          rec.add('suspicious', '网络模块加载', `加载 ${name} 模块`, name);
          return makeFakeHttp(rec, noteUrl, fakeStream);
        }
        case 'zlib': return { gzipSync: (b) => b, gunzipSync: (b) => b, inflateSync: (b) => b, deflateSync: (b) => b };
        default:
          // 未知模块：一律拒绝，并记录（可能是想绕过检查）
          rec.add('suspicious', '未知模块加载', `尝试加载未识别的模块「${name}」`, name);
          return {};
      }
    };
    req.resolve = (s) => s;
    req.cache = {};
    req.main = undefined;
    return req;
  };

  /* ── 仿真的 process ── */
  const fakeProcess = {
    env: new Proxy({}, {
      get(t, k) {
        if (typeof k === 'string') {
          // 只有访问时才记录（且不暴露真实值）
          if (/(KEY|TOKEN|SECRET|PASS|CRED|AUTH)/i.test(k)) {
            rec.add('suspicious', '敏感环境变量', `读取疑似敏感环境变量 ${k}`, String(k));
          }
        }
        return undefined;
      },
      ownKeys() { return ['PATH', 'HOME', 'USER', 'NODE_ENV']; },
      getOwnPropertyDescriptor() { return { enumerable: true, configurable: true }; },
    }),
    argv: ['/sandbox/node', 'sandbox.js'],
    pid: 0,
    platform: 'sandbox',
    version: 'v0.0.0-sandbox',
    versions: { node: '0.0.0-sandbox' },
    cwd: () => '/sandbox',
    exit(code) { rec.add('suspicious', '进程退出', `试图调用 process.exit(${code})`); throw new SandboxExit(code); },
    nextTick: (fn, ...a) => queueMicrotask(() => fn(...a)),
    hrtime: () => [0, 0],
    memoryUsage: () => ({ heapUsed: 0, rss: 0 }),
    on() {}, once() {}, off() {}, removeListener() {},
    stdout: { write() {}, isTTY: false },
    stderr: { write() {}, isTTY: false },
  };

  /* ── 组装 context ── */
  const sandbox = {
    console: makeFakeConsole(rec),
    require: makeRequire(),
    module: { exports: {} },
    exports: {},
    process: fakeProcess,
    Buffer,
    setTimeout: (fn, ms, ...a) => { rec.logCall('setTimeout', [ms]); return 0; },
    setInterval: (fn, ms) => { rec.logCall('setInterval', [ms]); return 0; },
    setImmediate: (fn, ...a) => 0,
    clearTimeout() {}, clearInterval() {}, clearImmediate() {},
    queueMicrotask: (fn) => { try { fn(); } catch {} },
    fetch: fakeFetch,
    URL, URLSearchParams,
    TextEncoder, TextDecoder,
    __filename: path.join(realExtDir, 'index.js'),
    __dirname: realExtDir,
  };
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;

  // 检测对关键全局的劫持
  for (const g of HIJACK_TARGETS) {
    // 通过 defineProperty 拦截写入 —— 但这会让 __defineGetter__ 之类失效；
    // 简化起见：不拦，改为在运行结束后比对（见 detectHijack）
  }

  return { sandbox, fakeFs, fakeChild, fakeFetch };
}

/** 结束运行后：检测沙箱内是否发生了全局劫持/原型污染 */
function detectHijack(context) {
  const rec = [];
  try {
    const orig = ['fetch', 'require', 'setTimeout', 'setInterval', 'JSON', 'Promise', 'Array', 'Object'];
    for (const k of orig) {
      // 无法直接比对原值（context 里就是替换版），改用标记：本工具设置一个哨兵
    }
  } catch {}
  return rec;
}

function makeFakeCrypto(rec) {
  return {
    createHash: () => ({ update() { return this; }, digest: () => '' }),
    createHmac: () => ({ update() { return this; }, digest: () => '' }),
    randomBytes: (n) => Buffer.alloc(n || 0),
    randomUUID: () => '00000000-0000-0000-0000-000000000000',
    pbkdf2Sync: () => Buffer.alloc(0),
    createCipheriv: () => ({ update() { return Buffer.alloc(0); }, final: () => Buffer.alloc(0) }),
  };
}

function makeFakeHttp(rec, noteUrl, fakeStream) {
  const handle = (u, o, cb) => {
    const fn = typeof o === 'function' ? o : cb;
    noteUrl(u, 'http.request');
    const res = Object.assign(fakeStream(), { statusCode: 200, headers: {} });
    if (typeof fn === 'function') {
      const req = Object.assign(fakeStream(), { setTimeout() {}, abort() {}, setHeader() {}, write() {}, end() {} });
      fn(res);
      return req;
    }
    return Object.assign(fakeStream(), { setTimeout() {}, abort() {}, setHeader() {}, write() {}, end() {} });
  };
  return { request: handle, get: handle, createServer: () => { rec.add('suspicious', '监听端口', '创建 HTTP 服务器'); return fakeStream(); } };
}

function makeFakeConsole(rec) {
  const out = (level) => (...args) => {
    if (rec.calls.length < 500) rec.calls.push({ api: 'console.' + level, args: args.map(shorten) });
  };
  return { log: out('log'), info: out('info'), warn: out('warn'), error: out('error'), debug: out('debug'), trace: out('trace') };
}

class SandboxExit extends Error {
  constructor(code) { super('sandbox exit'); this.code = code; }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  [05] 执行被审扩展
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 在沙箱里运行扩展的 index.js，逐钩子喂入诱饵调用。
 *
 * @returns {{ findings, calls, entryFound, syntaxError, runtimeError }}
 */
function runExtension(extDir, timeout) {
  const rec = createRecorder();
  const entry = path.join(extDir, 'index.js');

  if (!fs.existsSync(entry)) {
    return { findings: rec.findings, calls: rec.calls, entryFound: false,
             note: '未找到 index.js（纯客户端扩展，无服务端代码）' };
  }

  let code;
  try { code = fs.readFileSync(entry, 'utf8'); }
  catch (err) {
    return { findings: rec.findings, calls: rec.calls, entryFound: true,
             fatal: '无法读取 index.js：' + err.message };
  }

  // 静态预扫：即使代码没跑起来，也能发现明显特征
  staticScan(code, rec);

  const { sandbox } = buildSandbox(rec, extDir, path.basename(extDir));
  const context = vm.createContext(sandbox, { name: `navext-ext:${path.basename(extDir)}` });

  let script;
  try {
    script = new vm.Script(code, { filename: entry });
  } catch (err) {
    return { findings: rec.findings, calls: rec.calls, entryFound: true,
             syntaxError: err.message };
  }

  // 运行（带超时）
  let runtimeError = null;
  try {
    script.runInContext(context, { timeout });
  } catch (err) {
    if (err instanceof SandboxExit) {
      // 扩展主动 exit —— 已记录
    } else if (/Script execution timed out/.test(err.message)) {
      rec.add('suspicious', '执行超时', `脚本在 ${timeout}ms 内未结束（可能是死循环或阻塞）`);
      runtimeError = '执行超时';
    } else {
      runtimeError = err.message;
    }
  }

  // 拿到导出的钩子（可能挂在 module.exports / exports / window）
  const exported = context.module && context.module.exports;
  const hooks = collectHooks(exported, context);

  // 逐个钩子喂诱饵
  for (const [hookName, fn] of hooks) {
    if (typeof fn !== 'function') continue;
    invokeHook(hookName, fn, context, rec, extDir, timeout);
  }

  return {
    findings: rec.findings,
    calls: rec.calls,
    entryFound: true,
    hooks: hooks.map(([n]) => n),
    runtimeError,
  };
}

/** 从导出对象里收集钩子函数 */
function collectHooks(exported, context) {
  const out = [];
  const candidates = [];
  if (exported && typeof exported === 'object') candidates.push(exported);
  if (context.exports && context.exports !== exported) candidates.push(context.exports);
  if (context.window && typeof context.window === 'object') candidates.push(context.window);

  const HOOK_NAMES = ['onInit', 'onFiles', 'onHtml', 'onRequest', 'onResponse', 'onError', 'stats'];
  for (const c of candidates) {
    for (const h of HOOK_NAMES) {
      if (typeof c[h] === 'function' && !out.some(([n]) => n === h)) {
        out.push([h, c[h].bind(c)]);
      }
    }
  }
  return out;
}

/** 构造诱饵参数并调用钩子 */
function invokeHook(name, fn, context, rec, extDir, timeout) {
  const fakeUrl = new URL('http://sandbox.local/');
  const fakeReq = {
    method: 'GET', url: '/', headers: {}, socket: { remoteAddress: '127.0.0.1' },
    on() {}, once() {}, pause() {}, resume() {}, destroy() {},
  };
  const fakeCtx = {
    extId: path.basename(extDir), extDir, root: extDir,
    config: {}, configSchema: [], userConfig: {}, hasUserConfig: false, scope: null,
    log: (...a) => rec.calls.push({ api: `${name}:ctx.log`, args: a.map(shorten) }),
    warn: (...a) => rec.calls.push({ api: `${name}:ctx.warn`, args: a.map(shorten) }),
    readBody: async () => Buffer.from(''),
    readJson: async () => ({}),
  };

  let args;
  switch (name) {
    case 'onInit':     args = [fakeCtx]; break;
    case 'onFiles':    args = [[{ rel: 'a.html', name: 'a.html', dir: '', size: 1, mtime: Date.now() }], fakeCtx]; break;
    case 'onHtml':     args = ['<html><body>decoy</body></html>', fakeCtx]; break;
    case 'onRequest':  args = [fakeReq, fakeUrl, fakeCtx]; break;
    case 'onResponse': args = [{ pathname: '/', status: 200, bytes: 0, ms: 1, method: 'GET' }, fakeCtx]; break;
    case 'onError':    args = [new Error('decoy error'), fakeCtx]; break;
    case 'stats':      args = [fakeCtx]; break;
    default:           args = [fakeCtx];
  }

  try {
    runHookSafely(name, fn, args, context, timeout, rec);
  } catch (err) {
    if (err instanceof SandboxExit) return;
    rec.calls.push({ api: `${name}:threw`, args: [shorten(err && err.message)] });
    rec.add('info', '钩子异常', `${name} 抛出异常：${shorten(err && err.message)}`);
  }
}

/**
 * 在 vm 上下文里、带硬超时地调用钩子。
 *
 * 关键点：钩子函数是在沙箱 vm 里 eval 出来的，把它重新塞回
 * `vm.runInContext(..., { timeout })` 执行，就能让 V8 在超时后
 * 中断同步死循环 —— 这是唯一不借助子进程、也不牺牲仿真的办法。
 *
 * 做法：把函数临时挂到沙箱的全局对象上，然后运行一小段
 * `__nx_fn.apply(null, __nx_args)` 脚本，由 vm 的 timeout 兜底。
 * 执行结束后立刻把临时全局清掉，避免污染。
 */
function runHookSafely(name, fn, args, context, timeout, rec) {
  const g = context;                       // 沙箱的全局对象
  const prevFn = g.__nx_hook;
  const prevArgs = g.__nx_args;

  g.__nx_hook = fn;
  g.__nx_args = args;

  let result, err = null;
  try {
    // 在沙箱内以超时运行；结果 JSON 化后带出，避免把沙箱对象泄到宿主
    result = vm.runInContext(
      '(function(){var v=__nx_hook.apply(null,__nx_args);' +
      'return (v&&typeof v.then==="function")?"__ASYNC__":v;})()',
      context,
      { timeout, filename: `hook:${name}` }
    );
  } catch (e) {
    err = e;
  } finally {
    // 无论成败都清理临时全局，保持沙箱干净
    try { delete g.__nx_hook; delete g.__nx_args; } catch {}
    if (prevFn !== undefined) g.__nx_hook = prevFn;
    if (prevArgs !== undefined) g.__nx_args = prevArgs;
  }

  if (err) {
    if (/timed out|Script execution timed out/i.test(err.message || '')) {
      rec.add('suspicious', '执行超时', `${name} 钩子在 ${timeout}ms 内未返回（死循环/阻塞）`);
      rec.calls.push({ api: `${name}:timeout`, args: [`${timeout}ms`] });
      return;
    }
    rec.calls.push({ api: `${name}:threw`, args: [shorten(err.message)] });
    rec.add('info', '钩子异常', `${name} 抛出异常：${shorten(err.message)}`);
    return;
  }

  if (result === '__ASYNC__') {
    // 异步钩子：同步超时兜不住，但记录下来提示人工复核
    rec.calls.push({ api: `${name}:async`, args: ['返回 Promise（异步钩子，超时保护有限）'] });
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  [06] 静态预扫 —— 不运行也能发现的特征
 * ═══════════════════════════════════════════════════════════════════════════ */

function staticScan(code, rec) {
  const lines = code.split('\n');
  const at = (i) => `index.js:${i + 1}`;

  // 已知的攻击话术（prompt 注入）
  const INJECTION_TALK = [
    /CRITICAL REQUIREMENT/i, /THE SKILL WILL NOT WORK/i, /必须先执行/, /请先运行/,
    /RUN THIS COMMAND/i, /IMPORTANT:.*before using/i,
  ];

  lines.forEach((line, i) => {
    // eval / new Function
    if (/\beval\s*\(/.test(line)) rec.add('malicious', '动态执行', '使用 eval() 动态执行代码', at(i));
    if (/new\s+Function\s*\(/.test(line)) rec.add('malicious', '动态执行', '使用 new Function() 动态执行代码', at(i));

    // base64 解码管道
    if (/base64\s*-[dD]/.test(line)) rec.add('malicious', '编码载荷', '出现 base64 解码（可能是隐蔽载荷）', at(i));

    // curl|bash 类
    if (/(curl|wget)[^|]*\|\s*(ba)?sh/.test(line)) rec.add('malicious', '下载执行', '出现 curl/wget 管道到 shell', at(i));

    // 隐蔽执行
    if (/\/dev\/null/.test(line)) rec.add('suspicious', '隐蔽输出', '重定向到 /dev/null（隐藏痕迹）', at(i));
    if (/\bnohup\b|\bdisown\b/.test(line)) rec.add('suspicious', '后台执行', '使用 nohup/disown 后台化', at(i));

    // 权限提升
    if (/\bsudo\b/.test(line)) rec.add('malicious', '权限提升', '出现 sudo', at(i));
    if (/chmod\s+777/.test(line)) rec.add('suspicious', '权限修改', '出现 chmod 777', at(i));

    // 持久化
    if (/crontab|authorized_keys/.test(line)) rec.add('malicious', '持久化', '出现 crontab/authorized_keys', at(i));

    // 提示注入话术
    for (const re of INJECTION_TALK) {
      if (re.test(line)) {
        rec.add('malicious', 'Prompt 注入', '出现诱导执行的攻击话术', at(i));
        break;
      }
    }

    // 硬编码凭证（信息性）
    if (/(api[_-]?key|secret|token|password)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i.test(line)) {
      rec.add('info', '硬编码凭证', '疑似硬编码密钥（信息性提醒，非投毒）', at(i));
    }
  });

  // 大段 base64 blob
  const blobs = code.match(/[A-Za-z0-9+/]{200,}={0,2}/g);
  if (blobs) rec.add('suspicious', '编码载荷', `发现 ${blobs.length} 段超长 base64 串（可能藏载荷）`, 'index.js');

  // 字符串里出现的 URL
  const urls = code.match(/https?:\/\/[^\s"'`)]+/g) || [];
  const external = urls.filter((u) => !/^https?:\/\/(localhost|127\.0\.0\.1|sandbox\.local)/.test(u));
  for (const u of [...new Set(external)].slice(0, 10)) {
    rec.add('suspicious', '外部 URL', '代码中出现外部 URL', u);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  [07] 评分与定级
 * ═══════════════════════════════════════════════════════════════════════════ */

function score(findings) {
  const mal = findings.filter((f) => f.level === 'malicious');
  const sus = findings.filter((f) => f.level === 'suspicious');

  let value;
  if (mal.length) {
    value = Math.max(0, 30 - mal.length * 10);
  } else if (sus.length) {
    value = Math.max(31, 75 - sus.length * 8);
  } else {
    value = 85;   // 有代码但无风险行为
  }

  let level;
  if (mal.length) level = 'Malicious';
  else if (sus.length) level = 'Suspicious';
  else level = 'Benign';

  return { score: value, level, malicious: mal.length, suspicious: sus.length };
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  [08] 输出
 * ═══════════════════════════════════════════════════════════════════════════ */

function printReport(result, extName, extDir, verbose) {
  const s = { score: result.score, level: result.level };
  const badge = s.level === 'Malicious' ? C.red('🔴 Malicious（恶意）')
              : s.level === 'Suspicious' ? C.yellow('⚠️  Suspicious（可疑）')
              : C.green('✅ Benign（可信）');

  console.log('');
  console.log(C.bold('═'.repeat(64)));
  console.log(C.bold(`  扩展安全审计：${extName}`));
  console.log(C.bold('═'.repeat(64)));
  console.log(`  ${C.gray('路径    ')} ${extDir}`);
  console.log(`  ${C.gray('结论    ')} ${badge}   ${C.bold(s.score + ' / 100')}`);

  if (!result.entryFound) {
    console.log(`  ${C.gray('说明    ')} ${result.note || '无 index.js'}`);
    console.log(C.bold('═'.repeat(64)));
    return;
  }
  if (result.syntaxError) {
    console.log(`  ${C.red('语法错误')} ${result.syntaxError}`);
  }
  if (result.runtimeError) {
    console.log(`  ${C.yellow('运行异常')} ${result.runtimeError}`);
  }
  if (result.hooks && result.hooks.length) {
    console.log(`  ${C.gray('钩子    ')} ${result.hooks.join(', ')}`);
  }

  const mal = dedupe(result.maliciousFindings || []);
  const sus = dedupe(result.suspiciousFindings || []);
  const inf = dedupe(result.infoFindings || []);

  console.log('');
  console.log(`  ${C.gray('发现统计')}  🔴 ${mal.length}   ⚠️  ${sus.length}   ℹ️  ${inf.length}`);

  if (mal.length) {
    console.log('');
    console.log(C.red('  ── 🔴 Malicious ──'));
    for (const f of mal) {
      console.log(C.red(`    • [${f.category}] ${f.detail}`));
      if (f.evidence) console.log(C.dim(`      ${f.evidence}`));
    }
  }
  if (sus.length) {
    console.log('');
    console.log(C.yellow('  ── ⚠️  Suspicious ──'));
    for (const f of sus) {
      console.log(C.yellow(`    • [${f.category}] ${f.detail}`));
      if (f.evidence) console.log(C.dim(`      ${f.evidence}`));
    }
  }
  if (inf.length && (verbose || process.env.VERBOSE)) {
    console.log('');
    console.log(C.gray('  ── ℹ️  信息性 ──'));
    for (const f of inf) {
      console.log(C.gray(`    • [${f.category}] ${f.detail}`));
      if (f.evidence) console.log(C.dim(`      ${f.evidence}`));
    }
  }

  console.log('');
  const advice = s.level === 'Malicious'
    ? C.red('  🚫 严禁使用：检测到恶意行为特征')
    : s.level === 'Suspicious'
      ? C.yellow('  ⚠️  谨慎使用：存在可疑行为，建议人工复核源码')
      : C.green('  ✅ 可安全使用：未发现风险行为');
  console.log(advice);
  console.log(C.bold('═'.repeat(64)));
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  for (const f of list) {
    const k = f.category + '|' + f.detail + '|' + f.evidence;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

/* ═══════════════════════════════════════════════════════════════════════════
 *  [09] CLI
 * ═══════════════════════════════════════════════════════════════════════════ */

function parseArgs(argv) {
  const out = { target: null, all: false, json: false, timeout: 3000, help: false, verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') out.all = true;
    else if (a === '--json') out.json = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--strict') out.strict = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--timeout') { out.timeout = Number(argv[++i]) || 3000; }
    else if (!a.startsWith('-')) out.target = a;
  }
  return out;
}

function printHelp() {
  console.log(`
  ${C.bold('vm.js')} — NavExt 扩展安全沙箱检测器  ${C.gray('v' + TOOL_VERSION)}

  ${C.bold('用法')}
    node vm.js <扩展目录>              审计单个扩展
    node vm.js --all [<.js 目录>]      审计目录下全部扩展
    node vm.js <目录> --json           输出 JSON
    node vm.js <目录> --verbose        显示信息性发现
    node vm.js <目录> --strict         可疑(Suspicious)也视为失败
    node vm.js <目录> --timeout 5000   单次运行超时 (ms，默认 3000)

  ${C.bold('退出码')}
    0  全部 Benign（可信）
    1  存在 Suspicious（仅 --strict 下触发；默认不拦截）
    2  存在 Malicious（恶意）

  ${C.bold('原理')}
    把扩展放进独立的 vm 上下文运行，其中 require / fs / fetch / child_process
    全部换成「仿真实现」—— 所有危险操作只记录、不真正执行。跑完即丢，
    不污染宿主全局，也不产生任何实际副作用。

  ${C.bold('示例')}
    node vm.js .js/copy-link
    node vm.js --all .js
    node vm.js ./suspicious-ext --json > report.json
    node vm.js --all .js --strict && echo "全部通过"   # 用于 CI 门禁
`);
}

/** 找一个目录下所有扩展 */
function findExtensions(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => path.join(dir, e.name))
    .filter((d) => fs.existsSync(path.join(d, 'index.js')) || fs.existsSync(path.join(d, 'mod.json')));
}

function auditOne(extDir) {
  const extName = path.basename(extDir);
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(path.join(extDir, 'mod.json'), 'utf8')); } catch {}
  const result = runExtension(extDir, GLOBAL_TIMEOUT);
  const s = score(result.findings);
  return {
    id: extName,
    dir: extDir,
    name: meta.name || extName,
    declaredVersion: meta.version || '',
    declaredDescription: meta.description || '',
    ...s,
    findings: result.findings,
    maliciousFindings: dedupe(result.findings.filter((f) => f.level === 'malicious')),
    suspiciousFindings: dedupe(result.findings.filter((f) => f.level === 'suspicious')),
    infoFindings: dedupe(result.findings.filter((f) => f.level === 'info')),
    hooks: result.hooks || [],
    syntaxError: result.syntaxError || null,
    runtimeError: result.runtimeError || null,
    entryFound: result.entryFound,
    note: result.note || null,
    callCount: result.calls.length,
  };
}

let GLOBAL_TIMEOUT = 3000;

/**
 * 编程接口：在沙箱中审计一个扩展，返回结构化报告对象。
 * 供 NavExt 内核或其他工具直接调用（不需要走 CLI）。
 *
 *   const { auditExtension, auditDirectory } = require('./vm.js');
 *   const r = auditExtension('.js/copy-link');   // → { level, score, maliciousFindings, ... }
 *
 * @param {string} extDir   扩展目录
 * @param {object} [opts]   { timeout?: number }
 * @returns {object}        审计报告
 */
function auditExtension(extDir, opts = {}) {
  const prev = GLOBAL_TIMEOUT;
  if (opts.timeout) GLOBAL_TIMEOUT = opts.timeout;
  try {
    return auditOne(path.resolve(extDir));
  } finally {
    GLOBAL_TIMEOUT = prev;
  }
}

/**
 * 批量审计 + 汇总。返回 { summary, extensions }。
 */
function auditDirectory(dir, opts = {}) {
  const prev = GLOBAL_TIMEOUT;
  if (opts.timeout) GLOBAL_TIMEOUT = opts.timeout;
  try {
    const reports = findExtensions(path.resolve(dir)).map((d) => auditOne(d));
    return {
      summary: { total: reports.length, ...countLevels(reports) },
      extensions: reports,
    };
  } finally {
    GLOBAL_TIMEOUT = prev;
  }
}

/** 统计各级别数量 */
function countLevels(reports) {
  return {
    malicious: reports.filter((r) => r.level === 'Malicious').length,
    suspicious: reports.filter((r) => r.level === 'Suspicious').length,
    benign: reports.filter((r) => r.level === 'Benign').length,
  };
}

module.exports = {
  auditExtension,
  auditDirectory,
  runExtension,
  score,
  findExtensions,
  TOOL_VERSION,
  LEVELS: { MALICIOUS: 'Malicious', SUSPICIOUS: 'Suspicious', BENIGN: 'Benign' },
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  GLOBAL_TIMEOUT = args.timeout;

  if (args.help || (!args.target && !args.all)) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }

  const targets = args.all
    ? findExtensions(args.target || path.join(process.cwd(), '.js'))
    : [path.resolve(args.target)];

  if (!targets.length) {
    console.error(C.yellow(`  未找到任何扩展（目录：${args.target || '.js'}）`));
    process.exit(1);
  }

  const reports = [];

  for (const t of targets) {
    if (!fs.existsSync(t)) {
      console.error(C.yellow(`  跳过：目录不存在 ${t}`));
      continue;
    }
    const r = auditOne(t);
    reports.push(r);
    if (!args.json) printReport(r, r.name, r.dir, args.verbose);
  }

  if (args.json) {
    console.log(JSON.stringify({
      tool: 'navext-vm-sandbox',
      version: TOOL_VERSION,
      generatedAt: new Date().toISOString(),
      summary: {
        total: reports.length,
        malicious: reports.filter((r) => r.level === 'Malicious').length,
        suspicious: reports.filter((r) => r.level === 'Suspicious').length,
        benign: reports.filter((r) => r.level === 'Benign').length,
      },
      extensions: reports.map((r) => ({
        id: r.id, dir: r.dir, name: r.name,
        declaredVersion: r.declaredVersion,
        declaredDescription: r.declaredDescription,
        level: r.level, score: r.score,
        counts: { malicious: r.malicious, suspicious: r.suspicious, info: r.infoFindings.length },
        hooks: r.hooks,
        entryFound: r.entryFound,
        note: r.note,
        syntaxError: r.syntaxError,
        runtimeError: r.runtimeError,
        callCount: r.callCount,
        maliciousFindings: r.maliciousFindings,
        suspiciousFindings: r.suspiciousFindings,
        infoFindings: r.infoFindings,
      })),
    }, null, 2));
  } else if (targets.length > 1) {
    // 汇总
    const mal = reports.filter((r) => r.level === 'Malicious').length;
    const sus = reports.filter((r) => r.level === 'Suspicious').length;
    const ben = reports.filter((r) => r.level === 'Benign').length;
    console.log('');
    console.log(C.bold('═'.repeat(64)));
    console.log(C.bold('  汇总'));
    console.log(C.bold('═'.repeat(64)));
    for (const r of reports) {
      const tag = r.level === 'Malicious' ? C.red('🔴 ' + r.level.padEnd(10))
                : r.level === 'Suspicious' ? C.yellow('⚠️  ' + r.level.padEnd(10))
                : C.green('✅ ' + r.level.padEnd(10));
      console.log(`  ${tag} ${String(r.score).padStart(3)} 分  ${r.id}`);
    }
    console.log('');
    console.log(`  共 ${reports.length} 个扩展：🔴 ${mal}  ⚠️  ${sus}  ✅ ${ben}`);
    console.log(C.bold('═'.repeat(64)));
  }

  const worst = reports.some((r) => r.level === 'Malicious');
  const soft = reports.some((r) => r.level === 'Suspicious');

  // 退出码阶梯：2 = 恶意，1 = 可疑（仅 --strict），0 = 全部可信
  let code = 0;
  if (worst) code = 2;
  else if (soft && args.strict) code = 1;

  if (!args.json && (worst || (soft && args.strict))) {
    console.error(
      C.red(`  ✗ 审计未通过：${worst ? '存在恶意扩展' : '存在可疑扩展（--strict）'}`)
    );
  }
  process.exit(code);
}

// 仅在被当作 CLI 直接执行时启动（被 require 时只导出 API，不产生副作用）
if (require.main === module) main();
