#!/bin/bash
# 라온 교회 올인원 시작 (터미널 없이 실행 가능). 이미 켜져 있으면 브라우저만 엽니다.
export PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-5191}"
mkdir -p "$HOME/.raon-workspace"
cd "$DIR"
[ -d node_modules ] || npm install --no-audit --no-fund >>"$HOME/.raon-workspace/allinone.log" 2>&1
[ -f dist/index.html ] || npm run build >>"$HOME/.raon-workspace/allinone.log" 2>&1
# 켜져 있는 서버가 이 앱보다 옛 버전이면 끈다 (새로 설치했는데 옛 서버가 계속 도는 일 막기)
PORT=$PORT node server/launch-check.mjs >>"$HOME/.raon-workspace/allinone.log" 2>&1
if ! curl -s -o /dev/null "http://localhost:$PORT/api/health"; then
  PORT=$PORT nohup node server/index.mjs >>"$HOME/.raon-workspace/allinone.log" 2>&1 &
  for i in $(seq 1 30); do curl -s -o /dev/null "http://localhost:$PORT/api/health" && break; sleep 0.3; done
fi
open -a "Google Chrome" "http://localhost:$PORT" 2>/dev/null || open "http://localhost:$PORT"
