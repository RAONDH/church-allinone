#!/bin/bash
# 릴리스 파일 한 벌을 만듭니다: 전체 점검 → 맥·윈도우·업데이트 묶음 → SHA256SUMS.txt → 서명(SHA256SUMS.txt.sig) → 서명 확인
# 사용: installer/make-release.sh [만들 위치, 기본: 바탕화면/릴리스-버전]
# 서명에는 이 맥에만 있는 비밀 열쇠가 필요합니다 (~/.raon-workspace/signing/church-allinone-update.key · 처음이면 node installer/signing.mjs keygen)
set -euo pipefail
HUB="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$HUB/package.json').version")"
OUT="${1:-$HOME/Desktop/릴리스-$VERSION}"
# 배포 파일은 커밋한 코드 그대로여야 하고, 이미 낸 버전 번호로 다시 내면 안 된다
# (같은 번호면 설치된 프로그램이 새 것으로 알아보지 못해 업데이트가 오지 않는다). 급할 때만 ALLOW_DIRTY=1 로 건너뜀
if [ -z "${ALLOW_DIRTY:-}" ] && [ -d "$HUB/.git" ]; then
  if [ -n "$(git -C "$HUB" status --porcelain --untracked-files=normal)" ]; then
    echo "✗ 커밋하지 않은 변경이 있어 릴리스 파일을 만들지 않습니다. 먼저 커밋해 주세요:"; git -C "$HUB" status --short | head -20; exit 1
  fi
  if git -C "$HUB" rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null; then
    echo "✗ v$VERSION 태그가 이미 있습니다. package.json 의 버전을 올린 뒤 다시 만들어 주세요."; exit 1
  fi
fi
mkdir -p "$OUT"
# 배포 전 전체 점검(하네스): 실패하면 아무 파일도 만들지 않는다
node "$HUB/tests/run.js" --if-needed || { echo "✗ 점검이 실패해서 릴리스 파일을 만들지 않습니다."; exit 1; }
# 서명할 수 있는지 먼저 확인 (묶음을 다 만든 뒤에 막히지 않게)
KEY="${ALLINONE_SIGNING_KEY:-$HOME/.raon-workspace/signing/church-allinone-update.key}"
[ -f "$KEY" ] || { echo "✗ 서명 비밀 열쇠가 없습니다: $KEY"; exit 1; }
rm -f "$OUT"/교회올인원-설치-*.zip
bash "$HUB/installer/make-package.sh" "$OUT"
mv "$OUT"/교회올인원-설치-*.zip "$OUT/ChurchAllInOne-mac.zip"
bash "$HUB/installer/make-windows.sh" "$OUT"
bash "$HUB/installer/make-update.sh" "$OUT"
cd "$OUT"
shasum -a 256 ChurchAllInOne-mac.zip ChurchAllInOne-windows.zip ChurchAllInOne-update.zip > SHA256SUMS.txt
node "$HUB/installer/signing.mjs" sign "$OUT"
node "$HUB/installer/signing.mjs" verify "$OUT"
echo "✓ v$VERSION 릴리스 파일: $OUT"
echo "  올릴 파일: ChurchAllInOne-mac.zip ChurchAllInOne-windows.zip ChurchAllInOne-update.zip SHA256SUMS.txt SHA256SUMS.txt.sig"
