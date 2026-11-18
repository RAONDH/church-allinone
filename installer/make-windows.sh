#!/bin/bash
# 윈도우용 '라온 교회 올인원' 묶음(zip)을 만듭니다. 받는 사람은 Node.js 나 다른 것을 따로 설치할 필요가 없습니다.
#   - 공식 Node.js(윈도우용 node.exe) 를 받아 체크섬 확인 후 넣음
#   - 라온 교회 올인원 화면을 지금 빌드해서 넣음 (윈도우에서 npm 불필요)
#   - PraiseFlow 화면도 빌드해서 넣음 (API 키·백업은 넣지 않음)
#   - 예배송출 윈도우판은 공개 저장소(raon-easypaster/worship-caster) 최신 릴리스에서 받아 체크섬 확인 후 넣음
# 사용: installer/make-windows.sh [만들 위치, 기본: 바탕화면]
set -euo pipefail
HUB="$(cd "$(dirname "$0")/.." && pwd)"
PF="${PRAISEFLOW_DIR:-$HOME/Documents/praiseflow---예배-찬양-큐레이터}"
OUT="${1:-$HOME/Desktop}"
# 배포 전 전체 점검(하네스): 하나라도 실패하면 배포 파일을 만들지 않는다 (같은 코드로 이미 통과했으면 건너뜀)
node "$HUB/tests/run.js" --if-needed || { echo "✗ 점검이 실패해서 배포 파일을 만들지 않습니다. 위의 실패 내용을 고친 뒤 다시 실행하세요."; exit 1; }
NODE_V="v24.22.3"
CASTER_REPO="raon-easypaster/worship-caster"
CACHE="$HOME/.raon-workspace/build-cache"
STAGE="$(mktemp -d)"; trap 'rm -rf "$STAGE"' EXIT
ROOT="$STAGE/라온 교회 올인원"
VERSION="$(node -p "require('$HUB/package.json').version")"
mkdir -p "$CACHE" "$ROOT/node" "$ROOT/apps" "$OUT"

echo "▶ Node.js $NODE_V (윈도우)"
cd "$CACHE"
[ -f "SHASUMS256-$NODE_V.txt" ] || curl -sfL "https://nodejs.org/dist/$NODE_V/SHASUMS256.txt" -o "SHASUMS256-$NODE_V.txt"
NZ="node-$NODE_V-win-x64.zip"
[ -f "$NZ" ] || curl -sfLO "https://nodejs.org/dist/$NODE_V/$NZ"
[ "$(grep " $NZ\$" "SHASUMS256-$NODE_V.txt" | cut -d' ' -f1)" = "$(shasum -a 256 "$NZ" | cut -d' ' -f1)" ] || { echo "체크섬 불일치: $NZ"; rm -f "$NZ"; exit 1; }
unzip -q -j -o "$NZ" "node-$NODE_V-win-x64/node.exe" -d "$ROOT/node"

echo "▶ 라온 교회 올인원 (화면 빌드)"
cd "$HUB"
npx vite build >/dev/null
mkdir -p "$ROOT/hub"
cp -R server dist apps.json package.json "$ROOT/hub/"

if [ -d "$PF" ]; then
  echo "▶ PraiseFlow (화면 빌드)"
  (cd "$PF" && npx vite build >/dev/null)
  mkdir -p "$ROOT/apps/PraiseFlow"
  cp -R "$PF/server.mjs" "$PF/dist" "$PF/package.json" "$ROOT/apps/PraiseFlow/"
else echo "⚠️  PraiseFlow 폴더가 없어 빼고 만듭니다: $PF"; fi

echo "▶ 예배송출 윈도우판 (공개 릴리스)"
cd "$CACHE"
TAG="$(gh release view -R "$CASTER_REPO" --json tagName -q .tagName 2>/dev/null || curl -sfL "https://api.github.com/repos/$CASTER_REPO/releases/latest" | python3 -c 'import json,sys;print(json.load(sys.stdin)["tag_name"])')"
CZ="WorshipCaster-windows-$TAG.zip"
if [ ! -f "$CZ" ]; then
  curl -sfL "https://github.com/$CASTER_REPO/releases/download/$TAG/WorshipCaster-windows.zip" -o "$CZ.part"
  curl -sfL "https://github.com/$CASTER_REPO/releases/download/$TAG/SHA256SUMS.txt" -o "caster-sums-$TAG.txt"
  [ "$(tr -d '\r' < "caster-sums-$TAG.txt" | grep ' WorshipCaster-windows.zip$' | cut -d' ' -f1)" = "$(shasum -a 256 "$CZ.part" | cut -d' ' -f1)" ] || { echo "예배송출 체크섬 불일치"; rm -f "$CZ.part"; exit 1; }
  mv "$CZ.part" "$CZ"
fi
python3 - "$CZ" "$ROOT/apps" <<'PY'
# 압축 안 이름이 UTF-8 표시 없이 들어간 경우도 한글이 깨지지 않게 풀기
import sys, zipfile, os
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as z:
    for i in z.infolist():
        name = i.filename
        if not (i.flag_bits & 0x800):
            try: name = name.encode('cp437').decode('utf-8')
            except Exception: pass
        out = os.path.join(dst, name)
        if name.endswith('/'): os.makedirs(out, exist_ok=True); continue
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with z.open(i) as f, open(out, 'wb') as g: g.write(f.read())
PY
CASTER="$ROOT/apps/예배송출"
[ -f "$CASTER/app/server.js" ] || { echo "예배송출 묶음 구조가 예상과 다릅니다"; ls -R "$ROOT/apps" | head; exit 1; }
rm -rf "$CASTER/node" "$CASTER/app/data"   # Node 는 묶음 맨 위의 것을 같이 씀, 남은 자료는 빼기
# 예배송출만 따로 켜고 싶을 때 쓰는 실행 파일 (묶음의 Node 사용)
sed 's/$/\r/' "$HUB/installer/windows/caster.cmd" > "$CASTER/예배송출 실행.cmd"

echo "▶ 설교 쇼츠 메이커 윈도우판 (공개 릴리스 설치 파일)"
SHORTS_REPO="raon-easypaster/sermon-shorts-maker"
cd "$CACHE"
STAG="$(gh release view -R "$SHORTS_REPO" --json tagName -q .tagName 2>/dev/null || curl -sfL "https://api.github.com/repos/$SHORTS_REPO/releases/latest" | python3 -c 'import json,sys;print(json.load(sys.stdin)["tag_name"])')"
SEXE="SermonShortsMaker-Setup-${STAG#v}.exe"
if [ ! -f "$SEXE" ]; then
  curl -sfL "https://github.com/$SHORTS_REPO/releases/download/$STAG/$SEXE" -o "$SEXE.part"
  curl -sfL "https://github.com/$SHORTS_REPO/releases/download/$STAG/SHA256SUMS.txt" -o "shorts-sums-$STAG.txt"
  [ "$(tr -d '\r' < "shorts-sums-$STAG.txt" | grep " $SEXE\$" | cut -d' ' -f1)" = "$(shasum -a 256 "$SEXE.part" | cut -d' ' -f1)" ] || { echo "설교 쇼츠 메이커 체크섬 불일치"; rm -f "$SEXE.part"; exit 1; }
  mv "$SEXE.part" "$SEXE"
fi
cp "$SEXE" "$ROOT/apps/설교 쇼츠 메이커 설치.exe"

echo "▶ HWP/PDF 변환기 (공개 저장소)"
HWPD="$ROOT/apps/hwp-pdf-to-markdown"
mkdir -p "$HWPD"
curl -sfL "https://codeload.github.com/raon-easypaster/hwp-pdf-to-markdown/tar.gz/refs/heads/main" | tar -xz -C "$HWPD" --strip-components 1
[ -f "$HWPD/app.py" ] || { echo "HWP/PDF 변환기를 받지 못했습니다"; exit 1; }
# 올인원이 창 없이 켜는 실행 파일 (영문만). 파이썬이 없으면 PYTHON_MISSING 을 남기고 끝낸다
sed 's/$/\r/' "$HUB/installer/windows/hwp-start-hub.cmd" > "$HWPD/start-hub.cmd"

echo "▶ 실행 파일 · 사용법"
# 실행 파일 내용은 영문만 (윈도우 명령 창 한글 깨짐 방지)
sed 's/$/\r/' "$HUB/installer/windows/allinone.cmd" > "$ROOT/라온 교회 올인원 실행.cmd"

python3 - "$ROOT/사용법.txt" "$VERSION" <<'PY'
import sys
path, ver = sys.argv[1], sys.argv[2]
text = f"""라온 교회 올인원 v{ver} (윈도우) — 만든 사람: 쉬운목사 이광복 · 무료로 나눕니다

1. 압축을 푼 '라온 교회 올인원' 폴더를 원하는 곳(예: 문서)에 두세요.
   (압축 파일 안에서 바로 실행하지 말고 꼭 먼저 압축을 풀어 주세요)
2. '라온 교회 올인원 실행.cmd' 를 두 번 누르세요.
   - "Windows의 PC 보호" 창이 뜨면 [추가 정보] → [실행]을 누르세요. (무료 프로그램이라 나오는 안내입니다)
   - 방화벽 질문이 나오면 [액세스 허용]을 누르세요.
3. 브라우저에 라온 교회 올인원이 열립니다 (주소: http://localhost:5191).
   처음엔 교회 이름을 넣고 시작하거나, '예제'로 먼저 둘러보세요.
4. 작업 표시줄의 'ChurchAllInOne' 창이 프로그램 본체입니다. 닫으면 꺼집니다.

들어 있는 것
- 라온 교회 올인원 (이번 주 예배 준비)
- 예배송출 (자막·콘티 송출) — 라온 교회 올인원에서 필요할 때 저절로 켭니다. 따로 켜려면 apps\\예배송출\\예배송출 실행.cmd
- PraiseFlow 찬양 큐레이터 (찬양 추천)
- 설교 쇼츠 메이커 — 라온 교회 올인원 '프로그램'에서 [설치하기]를 누르거나 apps\\설교 쇼츠 메이커 설치.exe 를 실행해 설치합니다. 설치한 뒤에는 바탕화면 아이콘이나 올인원에서 엽니다.
- HWP/PDF 변환기 — 파이썬(Python 3)이 필요합니다. https://www.python.org/downloads/ 에서 설치할 때 'Add Python to PATH'를 꼭 체크하세요. 처음 열 때 필요한 부품을 저절로 받습니다.
- Node.js (프로그램 안에 들어 있어 따로 설치할 필요 없음)

AI 기능 (찬양 추천 · 설교 후 자료 · 회의록 정리)
- 이 컴퓨터에 Claude Code 또는 Codex 를 설치하고 로그인해 두면, API 키 없이 쓰고 계신 구독으로 만듭니다.
- 찬양 추천은 Gemini API 키로도 됩니다 (PraiseFlow 오른쪽 위 'AI 연결').

자료 저장 위치
- 라온 교회 올인원: %APPDATA%\\ChurchAllInOne (매일 자동 백업, 14일 보관)
- 예배송출: %APPDATA%\\WorshipCaster
업데이트할 때는 '라온 교회 올인원' 폴더만 새것으로 바꾸면 됩니다. 자료는 그대로 남습니다.

성도 명부·재정·행정(일정·회의록·봉사·증명서)도 위 메뉴에서 씁니다. 이 자료는 AI나 인터넷으로 보내지 않습니다.
회의 녹음을 받아 적으려면 행정 → 회의록 → '녹취 준비'에서 엔진과 모델을 먼저 받아 주세요.
사용법은 프로그램 위 메뉴 '사용설명서'에 있습니다.
문의: 카카오 오픈채팅 https://open.kakao.com/o/gSkET2Wi

후원 안내
라온 교회 올인원은 자율 후원으로 운영됩니다. 후원은 부담을 갖지 않으셔도 됩니다. 무료로 사용하셔도 괜찮습니다.
카카오뱅크 3333-01-9034483 (이광복)
"""
open(path, 'w', encoding='utf-8-sig', newline='\r\n').write(text)
PY

ZIP="$OUT/ChurchAllInOne-windows.zip"
rm -f "$ZIP"
python3 - "$STAGE" "$ZIP" <<'PY'
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for base, dirs, files in os.walk(src):
        dirs.sort()
        for f in sorted(files):
            if f == '.DS_Store': continue
            p = os.path.join(base, f)
            z.write(p, os.path.relpath(p, src))   # 한글 이름은 UTF-8 표시와 함께 저장됨
PY
echo "✓ 윈도우 묶음: $ZIP ($(du -h "$ZIP" | cut -f1))"
