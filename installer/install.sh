#!/bin/bash
# 라온 교회 올인원 한 번에 설치하기
# 이 파일이 있는 폴더(설치 묶음)에서 다음을 설치합니다.
#   1) Node.js (없을 때만, nodejs.org 공식 파일 · 내 계정 폴더 ~/.local/node 에 설치)
#   2) 라온 교회 올인원        → ~/교회 올인원      (이미 있으면 프로그램만 새로 바꾸고 data 폴더의 자료는 그대로 둠)
#   3) 예배송출.app       → ~/Applications    (이미 있으면 건드리지 않음)
#   4) PraiseFlow 찬양 큐레이터 → ~/Documents/praiseflow---예배-찬양-큐레이터 (이미 있으면 건드리지 않음)
#   5) 바탕화면에 '라온 교회 올인원' 실행 아이콘
# 관리자 암호는 필요 없습니다. 인터넷 연결이 필요합니다(Node.js·부품 내려받기).
set -u
PKG="$(cd "$(dirname "$0")" && pwd)"
NODE_VERSION="24.22.3"
HUB="$HOME/교회 올인원"
PF="$HOME/Documents/praiseflow---예배-찬양-큐레이터"
LOG="$HOME/.raon-workspace/install.log"
mkdir -p "$HOME/.raon-workspace" "$HOME/Applications"
export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

say()  { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
ok()   { printf '  ✓ %s\n' "$1"; }
warn() { printf '  ⚠️  %s\n' "$1"; }
fail() { printf '\n\033[31m✗ %s\033[0m\n  자세한 기록: %s\n' "$1" "$LOG"; osascript -e "display alert \"라온 교회 올인원 설치\" message \"$1\" as critical" >/dev/null 2>&1; exit 1; }
echo "=== $(date) 설치 시작 ($PKG)" >>"$LOG"

echo "라온 교회 올인원 설치를 시작합니다. 몇 분 걸릴 수 있습니다. 창을 닫지 말아 주세요."

# ── 1) Node.js ─────────────────────────────────────
say "Node.js 확인"
node_ok() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 18 ]; }
if node_ok; then
  ok "이미 있음 ($(node -v))"
else
  case "$(uname -m)" in arm64) ARCH=arm64 ;; *) ARCH=x64 ;; esac
  NAME="node-v$NODE_VERSION-darwin-$ARCH"
  TMP="$(mktemp -d)"
  echo "  nodejs.org 에서 Node.js $NODE_VERSION 내려받는 중…"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/$NAME.tar.gz" -o "$TMP/node.tgz" >>"$LOG" 2>&1 || fail "Node.js를 내려받지 못했습니다. 인터넷 연결을 확인해 주세요."
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$TMP/sums" >>"$LOG" 2>&1 || fail "Node.js 확인 파일을 내려받지 못했습니다."
  WANT="$(grep " $NAME.tar.gz\$" "$TMP/sums" | cut -d' ' -f1)"
  GOT="$(shasum -a 256 "$TMP/node.tgz" | cut -d' ' -f1)"
  [ -n "$WANT" ] && [ "$WANT" = "$GOT" ] || fail "내려받은 Node.js 파일이 공식 파일과 다릅니다. 설치를 멈췄습니다."
  mkdir -p "$HOME/.local"
  rm -rf "$HOME/.local/node.new" && mkdir -p "$HOME/.local/node.new"
  tar -xzf "$TMP/node.tgz" -C "$HOME/.local/node.new" --strip-components 1 || fail "Node.js 압축을 풀지 못했습니다."
  rm -rf "$HOME/.local/node" && mv "$HOME/.local/node.new" "$HOME/.local/node"
  rm -rf "$TMP"
  node_ok || fail "Node.js 설치 뒤에도 실행되지 않습니다."
  ok "설치함 ($(node -v), ~/.local/node)"
fi

copy_dir() { # 원본 대상 [제외할 이름…]
  local src="$1" dst="$2"; shift 2
  local ex=(); for e in "$@"; do ex+=(--exclude "$e"); done
  mkdir -p "$dst" && rsync -a "${ex[@]}" "$src/" "$dst/" >>"$LOG" 2>&1
}

# ── 2) 라온 교회 올인원 ─────────────────────────────────
say "라온 교회 올인원 설치"
[ -d "$PKG/교회 올인원" ] || fail "설치 묶음에 '라온 교회 올인원' 폴더가 없습니다."
if [ "$(cd "$PKG/교회 올인원" && pwd -P)" = "$(cd "$HUB" 2>/dev/null && pwd -P)" ]; then
  ok "이 폴더 그대로 사용"
else
  if [ -d "$HUB" ]; then
    # 켜져 있으면 끄고 새 프로그램으로 바꿈 (교회 자료가 든 data 폴더는 그대로)
    pid="$(lsof -tnP -iTCP:5191 -sTCP:LISTEN 2>/dev/null)"; [ -n "$pid" ] && kill $pid 2>/dev/null
    ok "기존 설치 발견 · 자료(data 폴더)는 그대로 두고 프로그램만 바꿉니다"
  fi
  copy_dir "$PKG/교회 올인원" "$HUB" data node_modules dist || fail "라온 교회 올인원을 복사하지 못했습니다."
fi
cd "$HUB" || fail "$HUB 폴더로 들어가지 못했습니다."
echo "  부품 설치 중 (npm install)…"
npm install --no-audit --no-fund >>"$LOG" 2>&1 || fail "라온 교회 올인원 부품 설치(npm install)에 실패했습니다."
echo "  화면 만드는 중 (build)…"
npx vite build >>"$LOG" 2>&1 || fail "라온 교회 올인원 화면 만들기(build)에 실패했습니다."
chmod +x "$HUB/start.sh" "$HUB/교회 올인원 열기.command" 2>/dev/null
ok "$HUB"

# ── 3) 예배송출 ────────────────────────────────────
say "예배송출 (자막·콘티)"
if [ -d "$HOME/Applications/예배송출.app" ]; then
  ok "이미 설치됨 · 그대로 둡니다"
elif [ -d "$PKG/apps/예배송출.app" ]; then
  ditto "$PKG/apps/예배송출.app" "$HOME/Applications/예배송출.app" >>"$LOG" 2>&1 || fail "예배송출을 복사하지 못했습니다."
  xattr -dr com.apple.quarantine "$HOME/Applications/예배송출.app" 2>/dev/null
  ok "~/Applications/예배송출.app (자료는 ~/Library/Application Support/WorshipCaster 에 저장)"
else
  warn "설치 묶음에 예배송출이 없어 건너뜁니다. 자막·콘티 기능은 예배송출이 있어야 합니다."
fi

# ── 4) PraiseFlow 찬양 큐레이터 ─────────────────────
say "PraiseFlow 찬양 큐레이터"
if [ -d "$PF" ]; then
  ok "이미 설치됨 · 그대로 둡니다"
elif [ -d "$PKG/apps/PraiseFlow" ]; then
  copy_dir "$PKG/apps/PraiseFlow" "$PF" node_modules dist .env.local || fail "PraiseFlow를 복사하지 못했습니다."
  (cd "$PF" && npm install --no-audit --no-fund >>"$LOG" 2>&1 && npx vite build >>"$LOG" 2>&1) || fail "PraiseFlow 설치(npm install/build)에 실패했습니다."
  chmod +x "$PF/start-praiseflow.sh" 2>/dev/null
  ok "$PF"
else
  warn "설치 묶음에 PraiseFlow가 없어 건너뜁니다. 찬양 추천 기능은 PraiseFlow가 있어야 합니다."
fi

# ── 5) 바탕화면 실행 아이콘 ─────────────────────────
say "바탕화면 실행 아이콘"
APP="$HOME/Desktop/라온 교회 올인원.app"
# 예전 이름('교회 올인원')으로 만든 실행 아이콘이 우리 것이면 새 이름으로 바꿈
OLD="$HOME/Desktop/교회 올인원.app"
if [ -d "$OLD" ] && osadecompile "$OLD/Contents/Resources/Scripts/main.scpt" 2>/dev/null | grep -q "교회 올인원/start.sh"; then
  rm -rf "$OLD" && ok "예전 이름의 바탕화면 아이콘을 새 이름으로 바꿉니다"
fi
if [ -d "$APP" ] && ! osadecompile "$APP/Contents/Resources/Scripts/main.scpt" 2>/dev/null | grep -q "교회 올인원/start.sh"; then
  warn "바탕화면에 같은 이름의 다른 앱이 있어 건드리지 않았습니다. ~/교회 올인원 폴더의 '교회 올인원 열기.command' 로 실행하세요."
else
  rm -rf "$APP"
  osacompile -o "$APP" -e "do shell script quoted form of (POSIX path of (path to home folder) & \"교회 올인원/start.sh\") & \" >/dev/null 2>&1 &\"" >>"$LOG" 2>&1 \
    && ok "바탕화면 '라온 교회 올인원'" || warn "실행 아이콘을 만들지 못했습니다. ~/교회 올인원/교회 올인원 열기.command 로 실행하세요."
  [ -f "$PKG/교회 올인원/installer/icon.icns" ] && cp "$PKG/교회 올인원/installer/icon.icns" "$APP/Contents/Resources/applet.icns" 2>/dev/null && touch "$APP"
fi

# ── 마무리 ────────────────────────────────────────
say "설치를 마쳤습니다"
echo "  • 바탕화면의 '라온 교회 올인원'을 두 번 누르면 열립니다 (주소: http://localhost:5191)."
echo "  • 첫 화면에서 교회 이름을 넣으면 시작합니다. 먼저 둘러보려면 '먼저 예제로 둘러보기'를 고르세요."
echo "  • 찬양 추천은 PraiseFlow의 'AI 연결'에서 Claude·ChatGPT 구독 또는 Gemini API 키를 연결해야 합니다."
echo "  • 설교 인포그래픽·블로그 글·소그룹 나눔지는 Claude Code 또는 Codex 로그인이 필요합니다."
echo "  • 사용법은 프로그램 위 메뉴 '사용설명서'를 보세요."
echo "  • 설교 쇼츠·회계장부·주간묵상·HWP 변환기는 이 묶음에 들어 있지 않습니다(따로 설치하면 '프로그램' 화면에 나타납니다)."
echo
echo "  ♡ 후원 안내: 라온 교회 올인원은 자율 후원으로 운영됩니다. 후원은 부담을 갖지 않으셔도 됩니다. 무료로 사용하셔도 괜찮습니다."
echo "    카카오뱅크 3333-01-9034483 (이광복)"
echo "=== $(date) 설치 완료" >>"$LOG"
[ -n "${NO_START:-}" ] || { "$HUB/start.sh" >/dev/null 2>&1 & sleep 2; }
