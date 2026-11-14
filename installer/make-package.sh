#!/bin/bash
# 다른 맥에 설치할 '라온 교회 올인원 설치 묶음'(zip)을 만듭니다.
# 교회 자료(data 폴더), API 키(.env.local), 부품 폴더(node_modules), 백업 폴더는 넣지 않습니다.
# 사용: installer/make-package.sh [만들 위치, 기본: 바탕화면]
set -eu
HUB="$(cd "$(dirname "$0")/.." && pwd)"
PF="${PRAISEFLOW_DIR:-$HOME/Documents/praiseflow---예배-찬양-큐레이터}"
CASTER="${CASTER_APP:-$HOME/Applications/예배송출.app}"
OUT="${1:-$HOME/Desktop}"
STAMP="$(date +%Y%m%d)"
WORK="$(mktemp -d)/교회올인원-설치"
mkdir -p "$WORK/apps"

echo "▶ 라온 교회 올인원"
rsync -a --exclude data --exclude node_modules --exclude dist --exclude .DS_Store "$HUB/" "$WORK/교회 올인원/"

if [ -d "$PF" ]; then
  echo "▶ PraiseFlow"
  rsync -a --exclude node_modules --exclude dist --exclude .env.local --exclude '*.local' --exclude 'backup-*' --exclude .DS_Store "$PF/" "$WORK/apps/PraiseFlow/"
else echo "⚠️  PraiseFlow 폴더가 없어 빼고 만듭니다: $PF"; fi

if [ -d "$CASTER" ]; then
  echo "▶ 예배송출.app"
  ditto "$CASTER" "$WORK/apps/예배송출.app"
  rm -rf "$WORK/apps/예배송출.app/Contents/Resources/app/data" # 앱 안에 남은 자료가 있으면 빼기 (원래 자료는 앱 밖에 저장)
else echo "⚠️  예배송출.app이 없어 빼고 만듭니다: $CASTER"; fi

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
- Node.js (컴퓨터에 없을 때만, ~/.local/node)

이미 설치된 컴퓨터에서 다시 실행하면 라온 교회 올인원 프로그램만 새 것으로 바뀌고,
입력해 둔 교회 자료와 예배송출·PraiseFlow는 그대로 둡니다.
관리자 암호는 필요 없습니다.

찬양 추천은 PraiseFlow 오른쪽 위 'AI 연결'에서 Claude 구독, ChatGPT 구독,
Gemini API 키 중 하나를 연결해야 쓸 수 있습니다.
설교 인포그래픽·블로그 글·소그룹 나눔지(예배 화면 '설교 후 자료' 탭)는
이 맥에 Claude Code 또는 Codex가 설치·로그인되어 있어야 만들 수 있습니다.
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
