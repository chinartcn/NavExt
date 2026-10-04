#!/usr/bin/env bash
# ============================================================================
# NavExt 异常场景测试套件 v3.1
# ----------------------------------------------------------------------------
# v3 → v3.1 修复：
#   1. now_ns() 跨平台时间戳（macOS BSD date 不支持 %N，自动降级到秒级）
#   2. 测试 6 补断言：非法 mod.json 应被降级加载（用目录名当 name）
#   3. 执行顺序修正：测试 6 在测试 7 之前，与编号一致
#
# 跨平台：Linux / macOS / Termux 均可运行
# ============================================================================

set -u

PROJECT_DIR="${1:-$PWD}"
USER_PORT="${2:-}"
HOST="127.0.0.1"
MARKER="__NAVEXT_ANOMALY_$(date +%s)__"

if [ -t 1 ]; then
  RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'
  BLUE=$'\033[0;34m'; CYAN=$'\033[0;36m'; BOLD=$'\033[1m'; NC=$'\033[0m'
else
  RED=; GREEN=; YELLOW=; BLUE=; CYAN=; BOLD=; NC=
fi

PASS=0; FAIL=0; WARN=0
pass() { echo -e "  ${GREEN}✓ PASS${NC}  $*"; PASS=$((PASS+1)); }
fail() { echo -e "  ${RED}✗ FAIL${NC}  $*"; FAIL=$((FAIL+1)); }
warn() { echo -e "  ${YELLOW}⚠ WARN${NC}  $*"; WARN=$((WARN+1)); }
info() { echo -e "  ${BLUE}ℹ INFO${NC}  $*"; }
section() { echo -e "\n${CYAN}${BOLD}════════════════════════════════════════════════════════════${NC}";
            echo -e "${CYAN}${BOLD}  $*${NC}";
            echo -e "${CYAN}${BOLD}════════════════════════════════════════════════════════════${NC}"; }

# ---------- 跨平台时间戳 ----------
# 优先 date +%s%N（GNU date：Linux/Termux 支持）；BSD date（macOS）不支持 %N
# 探测方式：输出的最后一个字符不含字面量 "N" 才算真纳秒
_NS_SUPPORTED=0
_probe="$(date +%s%N 2>/dev/null || echo '')"
if [ -n "$_probe" ] && [ "${_probe%N}" = "$_probe" ]; then
  _NS_SUPPORTED=1
fi

now_ns() {
  if [ "$_NS_SUPPORTED" = "1" ]; then
    date +%s%N
  else
    # 秒 × 10^9，至少保证算术不会因空串崩
    echo "$(( $(date +%s) * 1000000000 ))"
  fi
}

# ---------- 找 server 源 ----------
if [ -f "$PROJECT_DIR/server.js" ]; then
  SERVER_SRC="$PROJECT_DIR/server.js"
elif [ -f "$PROJECT_DIR/server.dist.js" ]; then
  SERVER_SRC="$PROJECT_DIR/server.dist.js"
else
  echo -e "${RED}找不到 server.js / server.dist.js：$PROJECT_DIR${NC}"; exit 1
fi

# ---------- 选端口 ----------
port_in_use() {
  curl -sf --max-time 0.5 "http://$HOST:$1/" >/dev/null 2>&1
}

pick_free_port() {
  node -e '
    const net = require("net");
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => process.stdout.write(String(p)));
    });
  '
}

if [ -n "$USER_PORT" ]; then
  PORT="$USER_PORT"
  if port_in_use "$PORT"; then
    echo -e "${RED}端口 $PORT 已被占用。${NC}"
    echo "请先停掉占用该端口的进程，或省略端口参数让脚本自动选。"
    exit 1
  fi
else
  PORT="$(pick_free_port)"
  while port_in_use "$PORT"; do PORT="$(pick_free_port)"; done
fi

BASE="http://$HOST:$PORT"

echo -e "${BOLD}NavExt 异常测试套件 v3.1${NC}"
echo "  项目目录: $PROJECT_DIR"
echo "  服务文件: $SERVER_SRC"
echo "  测试端口: $PORT  (自动选取)"
echo "  身份标记: $MARKER"
if [ "$_NS_SUPPORTED" = "1" ]; then
  echo "  时间精度: 纳秒"
else
  echo "  时间精度: 秒（BSD date 不支持 %N，性能数据仅供参考）"
fi

# ---------- 工作目录 ----------
WORK_DIR="$(mktemp -d -t navext-test31.XXXXXX)"
SERVER_PID=""
LOG_FILE=""

cleanup() {
  stop_server
  [ -n "${WORK_DIR:-}" ] && [ -d "$WORK_DIR" ] && rm -rf "$WORK_DIR"
}
trap cleanup EXIT INT TERM

cp "$SERVER_SRC" "$WORK_DIR/"
cp "$PROJECT_DIR/.navext.client.js" "$WORK_DIR/" 2>/dev/null || true

cat > "$WORK_DIR/server.json" << EOF
{
  "port": $PORT,
  "host": "$HOST",
  "site": { "title": "$MARKER" },
  "extensions": { "enabled": true, "dir": ".js" },
  "api": { "enabled": true, "writable": true }
}
EOF

# ---------- 服务器控制 ----------
start_server() {
  LOG_FILE="$WORK_DIR/server.log"
  : > "$LOG_FILE"
  ( cd "$WORK_DIR" && exec node "$(basename "$SERVER_SRC")" \
      --port "$PORT" --host "$HOST" ) \
      >> "$LOG_FILE" 2>&1 &
  SERVER_PID=$!

  for _ in $(seq 1 80); do
    if curl -sf --max-time 0.5 "$BASE/" >/dev/null 2>&1; then
      verify_identity && return 0
      return 3
    fi
    kill -0 "$SERVER_PID" 2>/dev/null || return 1
    sleep 0.1
  done
  return 2
}

verify_identity() {
  local body
  body="$(curl -s --max-time 2 "$BASE/?format=json" 2>/dev/null || echo '')"
  echo "$body" | grep -q "$MARKER"
}

stop_server() {
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill -TERM "$SERVER_PID" 2>/dev/null
    for _ in $(seq 1 20); do
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
  SERVER_PID=""
}

reset_js() { rm -rf "$WORK_DIR/.js"; mkdir -p "$WORK_DIR/.js"; }
set_list() { cat > "$WORK_DIR/.js/js.list.json"; }

require_server() {
  stop_server
  local rc=0
  start_server || rc=$?
  case "$rc" in
    0) return 0 ;;
    1) fail "服务端进程崩溃"; tail -15 "$LOG_FILE" | sed 's/^/       /'; return 1 ;;
    2) fail "服务端超时未响应"; return 1 ;;
    3) fail "响应来源不是 sandbox server —— 端口被占"; return 1 ;;
  esac
}

# ============================================================================
test_ext_throws() {
  section "测试 1：index.js 抛异常时其他扩展是否继续加载"
  reset_js
  mkdir -p "$WORK_DIR/.js/good-ext" "$WORK_DIR/.js/bad-ext"

  set_list << 'EOF'
{ "extensions": ["good-ext", "bad-ext"] }
EOF
  cat > "$WORK_DIR/.js/good-ext/mod.json" << 'EOF'
{ "name": "好扩展", "order": 10 }
EOF
  cat > "$WORK_DIR/.js/good-ext/index.js" << 'EOF'
module.exports = { onInit(ctx) { ctx.log('good-ext onInit 执行'); } };
EOF
  echo 'console.log("[good-ext]");' > "$WORK_DIR/.js/good-ext/client.js"

  cat > "$WORK_DIR/.js/bad-ext/mod.json" << 'EOF'
{ "name": "坏扩展", "order": 20 }
EOF
  cat > "$WORK_DIR/.js/bad-ext/index.js" << 'EOF'
throw new Error('有意抛出的异常 BAD_EXT_MARKER');
EOF

  require_server || return
  pass "服务端进程未因扩展异常退出"
  sleep 0.8

  grep -q "good-ext onInit 执行" "$LOG_FILE" \
    && pass "good-ext onInit 执行了 —— 其他扩展不受影响" \
    || fail "good-ext 未加载"

  grep -q "BAD_EXT_MARKER" "$LOG_FILE" \
    && info "错误被记录: $(grep BAD_EXT_MARKER "$LOG_FILE" | head -1 | sed 's/^[[:space:]]*//')" \
    || warn "异常被静默吞掉"

  stop_server
}

# ============================================================================
test_missing_ext() {
  section "测试 2：js.list.json 引用不存在的扩展名"
  reset_js
  mkdir -p "$WORK_DIR/.js/good-ext"
  cat > "$WORK_DIR/.js/good-ext/mod.json" << 'EOF'
{ "name": "好扩展" }
EOF
  cat > "$WORK_DIR/.js/good-ext/index.js" << 'EOF'
module.exports = { onInit(ctx) { ctx.log('good-ext onInit 执行'); } };
EOF
  set_list << 'EOF'
{ "extensions": ["this-does-not-exist", "good-ext"] }
EOF

  require_server || return
  pass "服务端未因缺失的扩展名崩溃"
  sleep 0.8

  grep -q "this-does-not-exist" "$LOG_FILE" \
    && { info "日志提示: $(grep this-does-not-exist "$LOG_FILE" | head -1 | sed 's/^[[:space:]]*//')"; pass "缺失扩展被识别"; } \
    || warn "静默忽略缺失扩展"

  grep -q "good-ext onInit 执行" "$LOG_FILE" \
    && pass "有效扩展 good-ext 仍正常加载" \
    || fail "有效扩展未能加载"

  stop_server
}

# ============================================================================
test_onrequest_order() {
  section "测试 3：两个扩展同名 onRequest 的执行顺序"
  reset_js
  mkdir -p "$WORK_DIR/.js/ext-a" "$WORK_DIR/.js/ext-b"

  cat > "$WORK_DIR/.js/ext-a/mod.json" << 'EOF'
{ "name": "A扩展", "order": 10 }
EOF
  cat > "$WORK_DIR/.js/ext-a/index.js" << 'EOF'
module.exports = {
  onRequest(req, url) {
    if (url.pathname === '/order-test') {
      return { status: 200, type: 'text/plain; charset=utf-8', body: 'A-处理了' };
    }
    return null;
  }
};
EOF
  cat > "$WORK_DIR/.js/ext-b/mod.json" << 'EOF'
{ "name": "B扩展", "order": 20 }
EOF
  cat > "$WORK_DIR/.js/ext-b/index.js" << 'EOF'
module.exports = {
  onRequest(req, url) {
    if (url.pathname === '/order-test') {
      return { status: 200, type: 'text/plain; charset=utf-8', body: 'B-处理了' };
    }
    return null;
  }
};
EOF
  set_list << 'EOF'
{ "extensions": ["ext-a", "ext-b"] }
EOF

  require_server || return
  sleep 0.5

  R1="$(curl -s --max-time 3 "$BASE/order-test" || echo '<timeout>')"
  info "order A=10 B=20 → \"$R1\""
  if [ "$R1" = "A-处理了" ]; then
    pass "order 小的先执行"
  elif [ "$R1" = "B-处理了" ]; then
    warn "order 大的先执行，与文档不符"
  else
    fail "预期返回 A-处理了 / B-处理了，实际: $R1"
  fi

  cat > "$WORK_DIR/.js/ext-a/mod.json" << 'EOF'
{ "name": "A扩展", "order": 999 }
EOF
  cat > "$WORK_DIR/.js/ext-b/mod.json" << 'EOF'
{ "name": "B扩展", "order": 1 }
EOF
  sleep 1.2

  R2="$(curl -s --max-time 3 "$BASE/order-test" || echo '<timeout>')"
  info "反转 order A=999 B=1 → \"$R2\""
  if [ "$R1" != "$R2" ]; then
    pass "order 字段生效且支持热重载"
  else
    warn "order 反转后结果未变"
  fi

  stop_server
}

# ============================================================================
test_many_files() {
  section "测试 4：扩展目录含 500 个文件时的指纹扫描性能"
  reset_js
  mkdir -p "$WORK_DIR/.js/bulk-ext"

  cat > "$WORK_DIR/.js/bulk-ext/mod.json" << 'EOF'
{ "name": "批量扩展" }
EOF
  cat > "$WORK_DIR/.js/bulk-ext/index.js" << 'EOF'
module.exports = { onInit(ctx) { ctx.log('bulk-ext 加载完成'); } };
EOF
  echo 'console.log("[bulk-ext]");' > "$WORK_DIR/.js/bulk-ext/client.js"

  info "生成 500 个文件..."
  for i in $(seq 1 500); do echo "data $i" > "$WORK_DIR/.js/bulk-ext/data-$i.txt"; done

  set_list << 'EOF'
{ "extensions": ["bulk-ext"] }
EOF

  stop_server
  T0=$(now_ns)
  require_server || return
  T1=$(now_ns)
  info "启动耗时 ≈ $(( (T1-T0)/1000000 )) ms"

  T0=$(now_ns)
  for _ in $(seq 1 30); do curl -s --max-time 5 "$BASE/" >/dev/null; done
  T1=$(now_ns)
  TOTAL_MS=$(( (T1-T0)/1000000 ))
  AVG_MS=$(( TOTAL_MS / 30 ))
  info "连续 30 次请求总耗时 ${TOTAL_MS} ms，平均 ${AVG_MS} ms/次"

  echo "changed" >> "$WORK_DIR/.js/bulk-ext/data-1.txt"
  sleep 0.5
  T0=$(now_ns)
  curl -s --max-time 5 "$BASE/" >/dev/null
  T1=$(now_ns)
  info "指纹失效后单次请求 ≈ $(( (T1-T0)/1000000 )) ms"

  # 注意：秒精度下这个阈值判定参考价值有限
  if [ "$AVG_MS" -lt 200 ]; then
    pass "500 文件场景性能良好 (${AVG_MS}ms/次)"
  elif [ "$AVG_MS" -lt 800 ]; then
    warn "略有开销 (${AVG_MS}ms/次)"
  else
    fail "可能存在阻塞 (${AVG_MS}ms/次)"
  fi

  stop_server
}

# ============================================================================
test_scope_rules() {
  section "测试 5：scope 路径规则（onRequest 探测）"
  reset_js
  mkdir -p "$WORK_DIR/.js/scope-probe" "$WORK_DIR/docs"
  echo '<!DOCTYPE html><html><body>docs</body></html>' > "$WORK_DIR/docs/page.html"

  cat > "$WORK_DIR/.js/scope-probe/mod.json" << 'EOF'
{ "name": "scope-probe" }
EOF
  cat > "$WORK_DIR/.js/scope-probe/index.js" << 'EOF'
module.exports = {
  onRequest(req, url) {
    if (url.pathname === '/docs/page.html') {
      return { status: 200, type: 'text/plain; charset=utf-8', body: 'HIT' };
    }
    return null;
  }
};
EOF

  require_server || return
  sleep 0.5

  probe() {
    local body
    body="$(curl -s --max-time 3 "$BASE/docs/page.html")"
    if [ "$body" = "HIT" ]; then
      echo "  ${GREEN}[命中]${NC}   $1"
      return 0
    else
      echo "  ${YELLOW}[未命中]${NC} $1"
      return 1
    fi
  }

  apply() { cat > "$WORK_DIR/.js/js.list.json"; sleep 1.0; }

  echo '{ "extensions": ["scope-probe"] }' | apply
  if probe "无 scope（基线）"; then
    pass "基线：无 scope 全局生效"
  else
    fail "基线失效 —— scope-probe 未加载或 onRequest 未触发"
    stop_server; return
  fi

  declare -a CASES=(
    '/*|1|匹配所有'
    '/docs/*|1|匹配 /docs/ 下全部'
    '/docs|0|精确匹配，不覆盖子路径'
    '/DOCS/*|1|大写 glob 匹配小写路径'
    '/docs/page.html|1|完整路径精确匹配'
    '/DOCS/PAGE.HTML|1|完整路径大小写不敏感'
  )

  for row in "${CASES[@]}"; do
    IFS='|' read -r pat expect desc <<< "$row"
    echo "{ \"extensions\": [{ \"id\": \"scope-probe\", \"paths\": [\"$pat\"] }] }" | apply
    if probe "paths=[$pat]  ($desc)"; then
      if [ "$expect" = "1" ]; then
        pass "$pat 符合预期（命中）"
      else
        fail "$pat 预期未命中却命中"
      fi
    else
      if [ "$expect" = "0" ]; then
        pass "$pat 符合预期（未命中）"
      else
        fail "$pat 预期命中却未命中"
      fi
    fi
  done

  stop_server
}

# ============================================================================
test_invalid_modjson() {
  section "测试 6：mod.json 是非法 JSON"
  reset_js
  mkdir -p "$WORK_DIR/.js/broken-json" "$WORK_DIR/.js/good-ext"

  echo '{ "name": "坏 JSON", this is not valid }' > "$WORK_DIR/.js/broken-json/mod.json"
  echo 'module.exports = { onInit(ctx) { ctx.log("broken-json onInit 执行"); } };' \
    > "$WORK_DIR/.js/broken-json/index.js"

  cat > "$WORK_DIR/.js/good-ext/mod.json" << 'EOF'
{ "name": "好扩展" }
EOF
  cat > "$WORK_DIR/.js/good-ext/index.js" << 'EOF'
module.exports = { onInit(ctx) { ctx.log('good-ext onInit 执行'); } };
EOF

  set_list << 'EOF'
{ "extensions": ["broken-json", "good-ext"] }
EOF

  require_server || return
  pass "服务端未因非法 mod.json 崩溃"
  sleep 0.8

  # 断言 1：好扩展不受影响
  grep -q "good-ext onInit 执行" "$LOG_FILE" \
    && pass "好扩展不受影响" \
    || fail "好扩展未能加载"

  # 断言 2：broken-json 被降级加载（用目录名做 name）
  # 依据：server.js 里 readJsonSafe(mod.json) || {} —— 非法 JSON 返回 null，|| {} 兜底
  # 因此 broken-json 会以 "目录名当 name、order=100" 的形态加载，而不是被跳过
  JSON_OUT="$(curl -s --max-time 2 "$BASE/?format=json" 2>/dev/null || echo '')"
  if echo "$JSON_OUT" | grep -q '"broken-json"'; then
    pass "非法 mod.json 被降级加载（未从扩展列表消失）"
  else
    warn "非法 mod.json 导致扩展被跳过 —— 与 readJsonSafe 降级行为不符，请核对 server.js"
  fi

  # 断言 3：broken-json 的 index.js 仍被执行（说明它被当扩展加载了，不是被丢弃）
  grep -q "broken-json onInit 执行" "$LOG_FILE" \
    && info "broken-json 的 index.js 正常执行" \
    || info "broken-json 的 index.js 未执行（可能实现选择跳过非法扩展）"

  stop_server
}

# ============================================================================
test_static_no_inject() {
  section "测试 7：静态 HTML 是否走扩展样式/脚本注入"
  reset_js
  mkdir -p "$WORK_DIR/.js/inject-ext" "$WORK_DIR/docs"
  echo '<!DOCTYPE html><html><head><meta charset="utf-8"><title>docs</title></head><body>doc page</body></html>' \
    > "$WORK_DIR/docs/page.html"

  cat > "$WORK_DIR/.js/inject-ext/mod.json" << 'EOF'
{ "name": "注入扩展" }
EOF
  cat > "$WORK_DIR/.js/inject-ext/js.json" << 'EOF'
{
  "styles": "inline: .__MARKER__{}",
  "scripts": "inline: console.log('INJECT_MARKER_XYZ');"
}
EOF

  set_list << 'EOF'
{ "extensions": ["inject-ext"] }
EOF

  require_server || return
  sleep 0.5

  BODY="$(curl -s --max-time 3 "$BASE/docs/page.html")"
  if echo "$BODY" | grep -q "INJECT_MARKER_XYZ"; then
    info "静态 HTML 中发现了扩展脚本"
    warn "静态 HTML 会注入扩展 —— 与'仅导航页注入'的预期不一致"
  else
    pass "静态 HTML 不含扩展注入 —— 边界清晰"
  fi

  HOME="$(curl -s --max-time 3 "$BASE/")"
  if echo "$HOME" | grep -q "INJECT_MARKER_XYZ"; then
    pass "导航页正常注入扩展脚本 —— 注入链工作正常"
  else
    fail "导航页未注入 —— 注入链可能有问题"
  fi

  stop_server
}

# ============================================================================
test_ext_throws
test_missing_ext
test_onrequest_order
test_many_files
test_scope_rules
test_invalid_modjson      # 编号 6
test_static_no_inject     # 编号 7

section "测试汇总"
echo -e "  ${GREEN}PASS${NC}: $PASS"
echo -e "  ${RED}FAIL${NC}: $FAIL"
echo -e "  ${YELLOW}WARN${NC}: $WARN"
echo

[ "$FAIL" -gt 0 ] && { echo -e "${RED}${BOLD}存在失败项。${NC}"; exit 1; } \
  || { echo -e "${GREEN}${BOLD}所有关键场景通过。${NC}"; exit 0; }