#!/bin/bash
# 다른 맥에 설치할 '라온 교회 올인원 설치 묶음'(zip)을 만듭니다.
# 교회 자료(data 폴더), API 키(.env.local), 부품 폴더(node_modules), 백업 폴더는 넣지 않습니다.
# 사용: installer/make-package.sh [만들 위치, 기본: 바탕화면]
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
PF="${PRAISEFLOW_DIR:-$HOME/Documents/praiseflow---예배-찬양-큐레이터}"
CASTER="${CASTER_APP:-$HOME/Applications/예배송출.app}"
OUT="${1:-$HOME/Desktop}"
# 배포 전 전체 점검(하네스): 하나라도 실패하면 배포 파일을 만들지 않는다 (같은 코드로 이미 통과했으면 건너뜀)
node "$HUB/tests/run.js" --if-needed || { echo "✗ 점검이 실패해서 배포 파일을 만들지 않습니다. 위의 실패 내용을 고친 뒤 다시 실행하세요."; exit 1; }
STAMP="$(date +%Y%m%d)"
WORK="$(mktemp -d)/교회올인원-설치"
mkdir -p "$WORK/apps"

echo "▶ 라온 교회 올인원"
rsync -a --exclude data --exclude node_modules --exclude dist --exclude .git --exclude docs --exclude .DS_Store "$HUB/" "$WORK/교회 올인원/"

if [ -d "$PF" ]; then
  echo "▶ PraiseFlow"
  rsync -a --exclude node_modules --exclude dist --exclude .git --exclude .env.local --exclude '*.local' --exclude 'backup-*' --exclude .DS_Store "$PF/" "$WORK/apps/PraiseFlow/"
else echo "⚠️  PraiseFlow 폴더가 없어 빼고 만듭니다: $PF"; fi

if [ -d "$CASTER" ]; then
  echo "▶ 예배송출.app"
  ditto "$CASTER" "$WORK/apps/예배송출.app"
  rm -rf "$WORK/apps/예배송출.app/Contents/Resources/app/data" # 앱 안에 남은 자료가 있으면 빼기 (원래 자료는 앱 밖에 저장)
else echo "⚠️  예배송출.app이 없어 빼고 만듭니다: $CASTER"; fi

# 설교 쇼츠 제작 · HWP/PDF 변환기: 이 맥의 폴더(개인 영상·작업 파일이 섞여 있음)가 아니라 공개 저장소의 원본을 받아 넣는다
fetch_src() { # 저장소 참조 대상폴더
  local tmp; tmp="$(mktemp -d)"
  curl -sfL "https://codeload.github.com/$1/tar.gz/$2" -o "$tmp/src.tgz" || { rm -rf "$tmp"; return 1; }
  mkdir -p "$3" && tar -xzf "$tmp/src.tgz" -C "$3" --strip-components 1; local r=$?; rm -rf "$tmp"; return $r
}
SHORTS_REPO="raon-easypaster/sermon-shorts-maker"
SHORTS_TAG="$(gh release view -R "$SHORTS_REPO" --json tagName -q .tagName 2>/dev/null || curl -sfL "https://api.github.com/repos/$SHORTS_REPO/releases/latest" | python3 -c 'import json,sys;print(json.load(sys.stdin)["tag_name"])')"
echo "▶ 설교 쇼츠 제작 ($SHORTS_TAG, 공개 저장소)"
fetch_src "$SHORTS_REPO" "refs/tags/$SHORTS_TAG" "$WORK/apps/sermon-shorts-maker" || { echo "설교 쇼츠 제작을 받지 못했습니다"; exit 1; }
echo "▶ HWP/PDF 변환기 (공개 저장소)"
. "$HUB/installer/pins.sh"
fetch_src "$HWP_REPO" "$HWP_COMMIT" "$WORK/apps/hwp-pdf-to-markdown" || { echo "HWP/PDF 변환기를 받지 못했습니다"; exit 1; }

cp "$HUB/installer/install.sh" "$WORK/설치하기.command"
chmod +x "$WORK/설치하기.command"
cat > "$WORK/읽어 주세요.txt" <<'TXT'
라온 교회 올인원 설치 방법

1. 이 폴더의 '설치하기.command'를 마우스 오른쪽 버튼으로 누르고 [열기]를 고릅니다.
   (처음 한 번은 "확인되지 않은 개발자" 경고가 뜹니다. 인터넷에서 받은 파일이라 그렇습니다.
    오른쪽 버튼 → 열기 → 다시 [열기]를 누르면 됩니다.)
2. 터미널 창이 열리고 몇 분 동안 설치가 진행됩니다. 인터넷 연결이 필요합니다.
3. 끝나면 바탕화면에 '라온 교회 올인원'이 생기고 자동으로 열립니다.

설치되는 것
- 라온 교회 올인원 (~/교회 올인원) · 이번 주 예배 준비 화면
- 예배송출 (~/Applications/예배송출.app) · 자막·콘티 송출
- PraiseFlow 찬양 큐레이터 (~/Documents) · 찬양 추천
- 설교 쇼츠 제작 (~/Applications/sermon-shorts-maker) · 설교 영상으로 쇼츠 만들기
- HWP/PDF 변환기 (~/Applications/hwp-pdf-to-markdown) · 한글·PDF 문서를 글로 바꾸기 (맥에 들어 있는 파이썬 사용)
- Node.js (컴퓨터에 없을 때만, ~/.local/node)

이미 설치된 컴퓨터에서 다시 실행하면 라온 교회 올인원 프로그램만 새 것으로 바뀌고,
입력해 둔 교회 자료와 예배송출·PraiseFlow·설교 쇼츠 제작·HWP 변환기는 그대로 둡니다.
관리자 암호는 필요 없습니다.

찬양 추천은 PraiseFlow 오른쪽 위 'AI 연결'에서 Claude 구독, ChatGPT 구독,
Gemini API 키 중 하나를 연결해야 쓸 수 있습니다.
설교 후 자료(인포그래픽·카드뉴스·주보 요약·나눔지·묵상·가정예배지 등, 예배 화면 '설교 후 자료' 탭)는
이 맥에 Claude Code 또는 Codex가 설치·로그인되어 있어야 만들 수 있습니다.
성도 명부·재정·행정(일정·회의록·봉사·증명서)도 위 메뉴에서 씁니다. 이 자료는 AI나 인터넷으로 보내지 않습니다.
회의 녹음을 받아 적으려면 행정 → 회의록 → '녹취 준비'를 먼저 해 주세요(맥은 brew install whisper-cpp).
자세한 사용법은 프로그램 위 메뉴 '사용설명서'에 있습니다.
문의: 카카오 오픈채팅 https://open.kakao.com/o/gSkET2Wi

후원 안내
라온 교회 올인원은 자율 후원으로 운영됩니다. 후원은 부담을 갖지 않으셔도 됩니다. 무료로 사용하셔도 괜찮습니다.
카카오뱅크 3333-01-9034483 (이광복)
TXT

mkdir -p "$OUT"
ZIP="$OUT/교회올인원-설치-$STAMP.zip"
rm -f "$ZIP"
(cd "$(dirname "$WORK")" && ditto -c -k --sequesterRsrc --keepParent "교회올인원-설치" "$ZIP")
rm -rf "$(dirname "$WORK")"
echo "✓ 설치 묶음: $ZIP ($(du -h "$ZIP" | cut -f1))"
