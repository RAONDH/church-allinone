#!/bin/bash
# 자동 업데이트용 묶음(ChurchAllInOne-update.zip)을 만듭니다. 맥·윈도우 공통입니다.
# 서버는 node 기본 기능만 쓰므로 server · 빌드된 화면(dist) · apps.json · package.json 만 담습니다.
# 릴리스에 이 파일과 SHA256SUMS.txt(이 파일의 확인값 포함)를 함께 올려야 프로그램이 자동 설치합니다.
# 사용: installer/make-update.sh [만들 위치, 기본: 바탕화면]
set -euo pipefail
HUB="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$HOME/Desktop}"
mkdir -p "$OUT"
cd "$HUB"
npx vite build >/dev/null
for f in server/index.mjs server/main.mjs server/boot.mjs dist/index.html apps.json package.json; do [ -f "$f" ] || { echo "$f 가 없습니다"; exit 1; }; done
ZIP="$OUT/ChurchAllInOne-update.zip"
rm -f "$ZIP"
python3 - "$HUB" "$ZIP" <<'PY'
import os, sys, zipfile
hub, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for top in ('server', 'dist'):
        for d, _, files in os.walk(os.path.join(hub, top)):
            for f in sorted(files):
                if f == '.DS_Store': continue
                p = os.path.join(d, f)
                z.write(p, os.path.relpath(p, hub))
    for f in ('apps.json', 'package.json'):
        z.write(os.path.join(hub, f), f)
PY
echo "✓ 업데이트 묶음: $ZIP ($(du -h "$ZIP" | cut -f1)) · 버전 $(node -p "require('./package.json').version")"
