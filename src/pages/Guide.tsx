import { Link } from 'react-router-dom';

const TOC = [
  ['start', '처음 시작하기'],
  ['week', '매주 준비 순서'],
  ['setlist', '찬양 콘티와 찬양 추천'],
  ['subs', '자막과 확정본'],
  ['after', '설교 후 자료'],
  ['ai', 'AI 구독 연결'],
  ['apps', '다른 프로그램'],
  ['data', '자료 보관과 백업'],
  ['offline', '인터넷 없이 쓸 때'],
  ['install', '설치와 업데이트 (맥·윈도우)'],
  ['faq', '자주 묻는 질문'],
  ['contact', '문의하기'],
] as const;

// 화면 사진 (예제 자료로 찍음). 누르면 크게 보기
function Shot({ src, cap }: { src: string; cap: string }) {
  return (
    <figure className="shot">
      <a href={`/guide/${src}`} target="_blank" rel="noopener"><img src={`/guide/${src}`} alt={cap} loading="lazy" /></a>
      <figcaption>{cap}</figcaption>
    </figure>
  );
}

export default function Guide() {
  return (
    <section className="narrow guide">
      <h1>사용설명서</h1>
      <p className="lead">라온 교회 올인원은 1인 목회자를 위한 <b>이번 주 예배 준비 화면</b>입니다. 이미 쓰고 있는 예배송출(자막), PraiseFlow(찬양 추천), 설교 쇼츠, 회계장부를 새로 만들지 않고 한 화면에 이어 줍니다.</p>

      <nav className="card toc" aria-label="차례">
        <b>차례</b>
        <ol>{TOC.map(([id, t]) => <li key={id}><a href={`#${id}`}>{t}</a></li>)}</ol>
      </nav>

      <div className="card" id="start">
        <h2>1. 처음 시작하기</h2>
        <ol>
          <li>맥은 바탕화면의 <b>라온 교회 올인원</b>, 윈도우는 <b>라온 교회 올인원 실행.cmd</b>를 두 번 누르면 브라우저에 열립니다 (주소 <code>http://localhost:5191</code>).</li>
          <li>첫 화면에서 교회 이름·목회자 이름·기본 예배 이름을 넣으면 시작합니다. 나중에 <Link to="/settings">설정</Link>에서 바꿀 수 있습니다.</li>
          <li>먼저 둘러보고 싶으면 오른쪽 위 <b>예제</b>를 누르세요. 예제에서 바꾼 것은 실제 교회 자료와 실제 예배송출에 아무 영향이 없습니다. <b>우리 교회</b>를 누르면 돌아옵니다.</li>
        </ol>
      </div>

      <div className="card" id="week">
        <h2>2. 매주 준비 순서</h2>
        <p><Link to="/">이번 주 준비함</Link>에서 <b>이번 주 예배 만들기</b>를 누르거나, <b>지난주 예배 복사</b>로 지난주 순서·광고를 이어받아 시작합니다. 그다음 예배 화면의 탭을 왼쪽부터 차례로 채우면 됩니다.</p>
        <Shot src="01-home.jpg" cap="이번 주 준비함 — 할 일이 순서대로 보이고, '다음으로 할 일'을 바로 누를 수 있습니다." />
        <table className="guide-table">
          <tbody>
            <tr><th>예배 정보</th><td>날짜, 본문, 설교 제목, 대표 기도, 광고, 설교 원고. 한 번 입력하면 예배송출 자막(성경 봉독·말씀 선포·교회 소식·대표 기도)에 자동으로 들어갑니다. 글을 쓰면 저절로 저장됩니다.</td></tr>
            <tr><th>찬양 콘티</th><td>찬양 자료에서 곡을 넣고 순서·조성·곡 구성을 정합니다. 찬양 추천도 여기서 받습니다.</td></tr>
            <tr><th>자막</th><td>예배 순서와 모든 자막 화면을 확인하고 <b>자막 확정</b>을 누릅니다.</td></tr>
            <tr><th>결과물</th><td>준비 상태 점검, 카톡용 콘티 글 복사, 콘티 인쇄, 확정본 보기.</td></tr>
            <tr><th>설교 후 자료</th><td>설교 원고로 인포그래픽·블로그 글·소그룹 나눔지를 만듭니다.</td></tr>
          </tbody>
        </table>
        <Shot src="02-info.jpg" cap="예배 정보 탭 — 본문·제목·대표 기도·광고를 한 번 쓰면 예배송출 자막에 그대로 들어갑니다." />
        <p className="muted small">탭 이름 옆 점은 아직 할 일이 남았다는 표시입니다. 이번 주 준비함의 <b>준비 이어하기</b>를 누르면 남은 곳으로 바로 갑니다.</p>
        <p className="muted small">예배송출과 처음 이을 때는 <b>예배송출에 주일 예배 순서 새로 만들기</b>를 누르거나, 이미 있는 순서를 골라 <b>이 순서와 연결</b>을 누릅니다.</p>
      </div>

      <div className="card" id="setlist">
        <h2>3. 찬양 콘티와 찬양 추천</h2>
        <ul>
          <li><b>찬양 자료에서 넣기</b>: 예배송출에 저장된 곡을 찾아 <b>넣기</b>. 위·아래로 순서를 바꾸고, 조성과 곡 구성(1절 → 후렴 …)을 정합니다.</li>
          <li><b>찬양 큐레이터(PraiseFlow) 추천</b>: 찬송가·CCM 곡 수를 고르고 추천받기. 본문·제목·원고를 읽고 곡과 추천 이유, 유튜브·악보 링크를 줍니다. 꺼져 있으면 저절로 켭니다(1~2분).</li>
          <li>추천 곡이 찬양 자료에 있으면 <b>콘티에 넣기</b>, 없으면 <b>새 곡으로 콘티에 넣기</b>(가사는 예배송출에서 넣습니다).</li>
          <li>조성·곡 구성은 곡 자체에 저장되어 다른 주에도 같이 바뀝니다. 지난 예배 모습은 자막 확정본으로 남겨 두세요.</li>
        </ul>
        <Shot src="03-setlist.jpg" cap="찬양 콘티 탭 — 왼쪽에서 순서·조성·곡 구성을 정하고, 오른쪽 찬양 자료에서 곡을 넣습니다." />
        <Shot src="03b-recommend.jpg" cap="찬양 추천 — 추천 이유와 분위기, 이미 콘티에 있는 곡, 바로 넣을 수 있는 곡이 함께 보입니다." />
      </div>

      <div className="card" id="subs">
        <h2>4. 자막과 확정본</h2>
        <ul>
          <li>예배송출은 고치는 즉시 송출 화면에 반영됩니다. 그래서 준비가 끝나면 <b>자막 확정</b>으로 그때의 순서와 자막을 따로 떠 둡니다.</li>
          <li>확정 뒤 바뀐 곳이 있으면 알려 주고, <b>확정본으로 되돌리기</b>로 되돌릴 수 있습니다.</li>
          <li><b>송출 화면 주소</b>는 예배당 TV나 OBS에 넣는 주소입니다. 자막 편집은 <b>예배송출에서 편집 ↗</b>을 누릅니다.</li>
        </ul>
        <Shot src="04-subs.jpg" cap="자막 탭 — 예배 순서와 자막 화면 수를 확인하고 '자막 확정'을 누릅니다." />
        <Shot src="05-outputs.jpg" cap="결과물 탭 — 준비 상태 점검, 카톡용 콘티 글 복사, 콘티 인쇄." />
      </div>

      <div className="card" id="after">
        <h2>5. 설교 후 자료</h2>
        <p>예배 정보 탭 <b>설교 원고</b>에 원고를 붙여 넣은 뒤(300자 이상), <b>설교 후 자료</b> 탭에서 <b>만들기</b>를 누릅니다. 자료 하나에 보통 2~5분 걸리고, 그동안 다른 화면으로 가도 됩니다.</p>
        <table className="guide-table">
          <tbody>
            <tr><th>🖼 설교 인포그래픽</th><td>대지·중심 말씀·핵심 단어·적용 체크리스트·기도문을 담은 한 장짜리 웹페이지. <b>열어 보기</b>, <b>파일로 받기</b>(.html)로 성도에게 나눕니다.</td></tr>
            <tr><th>✍️ 블로그 글</th><td>설교 말투를 읽는 글로 다듬은 글. <b>글 복사 (블로그용)</b>로 네이버 블로그·티스토리에 붙여 넣습니다. 해시태그도 붙어 있습니다.</td></tr>
            <tr><th>👥 소그룹 나눔지 (장년)</th><td>90분 순서와 질문, 중보기도 표, 접히는 인도자 가이드. 열어서 인쇄하면 A4로 나옵니다.</td></tr>
            <tr><th>🔥 소그룹 나눔지 (청소년)</th><td>75분 · 웜업, OX 퀴즈, 토크타임, 이번 주 챌린지, 함께 기도.</td></tr>
          </tbody>
        </table>
        <Shot src="06-after.jpg" cap="설교 후 자료 탭 — 자료마다 만들기·열어 보기·파일로 받기. 블로그 글은 바로 복사할 수 있습니다." />
        <div className="shot-pair">
          <Shot src="ex-infographic.jpg" cap="만든 예: 설교 인포그래픽 (예시 원고로 만든 실제 결과의 윗부분)" />
          <Shot src="ex-sg-adult.jpg" cap="만든 예: 장년 소그룹 나눔지 (같은 예시 원고)" />
        </div>
        <p className="alert warn small">AI가 만든 자료는 꼭 한 번 읽어 보고 나눠 주세요. 원고에 없는 구절이나 예화는 쓰지 않게 했지만, 성경 구절·인용이 원고와 같은지 확인이 필요합니다.</p>
        <p className="muted small">원고를 고쳤다면 <b>다시 만들기</b>를 누르세요. 만든 자료는 그 예배 기록에 보관되고, 예배 기록을 지우면 함께 지워집니다.</p>
      </div>

      <div className="card" id="ai">
        <h2>6. AI 구독 연결</h2>
        <p>찬양 추천과 설교 후 자료는 AI를 씁니다. API 키 없이 <b>이미 쓰는 구독</b>으로 됩니다(추가 요금 없음, 구독 사용량을 씀).</p>
        <ul>
          <li><b>Claude 구독</b>: 이 컴퓨터에 Claude Code를 설치하고 터미널에서 <code>claude</code>를 실행해 로그인.</li>
          <li><b>ChatGPT 구독</b>: Codex를 설치하고 터미널에서 <code>codex login</code>으로 로그인.</li>
          <li><b>Gemini API 키</b>: 찬양 추천(PraiseFlow)에서만 쓸 수 있습니다.</li>
        </ul>
        <p>찬양 추천에 쓸 방식은 PraiseFlow 오른쪽 위 <b>⚙ AI 연결</b>에서 고릅니다. 설교 후 자료는 거기서 고른 구독을 먼저 쓰고, 둘 다 로그인되어 있으면 탭에서 고를 수 있습니다.</p>
      </div>

      <div className="card" id="apps">
        <h2>7. 다른 프로그램</h2>
        <p><Link to="/apps">프로그램</Link> 화면에서 예배송출, PraiseFlow, 설교 쇼츠 제작, 회계장부, 주간묵상 생성기, HWP 변환기를 켜고 엽니다. 필요할 때는 저절로 켜집니다. 회계 자료는 회계장부 프로그램 안에만 있고 라온 교회 올인원은 열기만 합니다.</p>
        <p className="muted small">윈도우판에는 예배송출과 PraiseFlow가 들어 있습니다. 설교 쇼츠·회계장부·주간묵상·HWP 변환기는 아직 맥에서만 이어집니다.</p>
        <p>설교 영상 주소를 예배 정보 탭에 넣어 두면 결과물 탭에서 <b>주소 복사</b>로 쇼츠 제작에 바로 붙여 넣을 수 있습니다.</p>
      </div>

      <div className="card" id="data">
        <h2>8. 자료 보관과 백업</h2>
        <ul>
          <li>라온 교회 올인원 자료는 맥은 <code>교회 올인원/data</code> 폴더, 윈도우는 <code>%APPDATA%\ChurchAllInOne</code> 폴더에 있고, 매일 자동 백업해 14일 보관합니다.</li>
          <li>찬양 가사·곡 구성·자막은 예배송출에 저장됩니다. 예배송출의 백업(zip)도 함께 챙겨 주세요.</li>
          <li>예배 기록을 지워도 예배송출의 예배 순서는 지우지 않습니다.</li>
        </ul>
      </div>

      <div className="card" id="offline">
        <h2>9. 인터넷 없이 쓸 때</h2>
        <ul>
          <li>✅ 이번 주 준비함, 예배 정보, 콘티, 자막 확정은 이 컴퓨터 안에서만 동작합니다.</li>
          <li>✅ 자막 송출은 예배송출이 담당합니다.</li>
          <li>⚠️ 찬양 추천, 설교 후 자료 만들기, 가사 인터넷 검색, 쇼츠 제작은 인터넷이 필요합니다. 이미 만든 설교 후 자료는 인터넷 없이도 열립니다.</li>
        </ul>
      </div>

      <div className="card" id="install">
        <h2>10. 설치와 업데이트 (맥·윈도우)</h2>
        <p>받는 곳: <a href="https://raon-easypaster.github.io/church-allinone/" target="_blank" rel="noopener">raon-easypaster.github.io/church-allinone</a></p>
        <h3>맥 (ChurchAllInOne-mac.zip)</h3>
        <ol>
          <li>압축을 풀고 <code>설치하기.command</code>를 <b>마우스 오른쪽 버튼 → 열기</b>로 실행합니다. 처음 한 번 "확인되지 않은 개발자" 경고가 뜨면 다시 <b>열기</b>를 누르세요.</li>
          <li>몇 분 뒤 바탕화면에 <b>라온 교회 올인원</b>이 생기고 열립니다. 관리자 암호는 필요 없고 인터넷은 필요합니다.</li>
          <li>업데이트: 새 묶음으로 다시 실행하면 프로그램만 새것으로 바뀌고 자료는 그대로입니다.</li>
        </ol>
        <h3>윈도우 10·11 (ChurchAllInOne-windows.zip)</h3>
        <ol>
          <li>압축을 풀고 <b>라온 교회 올인원</b> 폴더를 문서 등 원하는 곳에 둡니다. 압축 파일 안에서 바로 실행하지 마세요.</li>
          <li><code>라온 교회 올인원 실행.cmd</code>를 두 번 누릅니다. "Windows의 PC 보호" 창이 뜨면 <b>추가 정보 → 실행</b>을 누르세요. 설치 과정 없이 바로 열립니다.</li>
          <li>작업 표시줄의 <b>ChurchAllInOne</b> 창이 프로그램 본체입니다. 닫으면 꺼집니다.</li>
          <li>업데이트: <b>라온 교회 올인원</b> 폴더만 새것으로 바꾸면 됩니다. 자료는 <code>%APPDATA%</code>에 따로 있어서 그대로 남습니다.</li>
        </ol>
      </div>

      <div className="card" id="faq">
        <h2>11. 자주 묻는 질문</h2>
        <dl>
          <dt>예배송출 연결 안 됨이라고 나와요.</dt>
          <dd>예배송출이 꺼져 있을 때입니다. <Link to="/apps">프로그램</Link>에서 예배송출을 열면 됩니다. 연결이 끊겨도 라온 교회 올인원에 입력한 내용은 저장되고, 다시 연결되면 자막에 반영됩니다.</dd>
          <dt>찬양 추천이나 설교 후 자료에서 "AI 연결 안 됨"이 나와요.</dt>
          <dd>이 컴퓨터에서 Claude Code나 Codex에 로그인되어 있지 않은 경우입니다. 6번을 보고 로그인한 뒤 <b>다시 확인</b>을 누르세요.</dd>
          <dt>"사용 한도에 걸렸습니다"가 나와요.</dt>
          <dd>구독 사용량을 다 쓴 경우입니다. 한도가 풀린 뒤 다시 누르거나, 다른 구독으로 바꿔 만드세요.</dd>
          <dt>예제 자료를 처음 상태로 되돌리고 싶어요.</dt>
          <dd>예제를 켠 상태에서 <Link to="/settings">설정</Link> 아래 <b>예제 자료 처음 상태로</b>를 누릅니다. 실제 교회 자료는 그대로입니다.</dd>
        </dl>
      </div>

      <div className="card" id="contact">
        <h2>12. 문의하기</h2>
        <p>쓰시다가 안 되는 것이 있거나, 이런 기능이 있었으면 좋겠다는 생각이 드시면 언제든 알려 주세요.</p>
        <p><a className="btn kakao" href="https://open.kakao.com/o/gSkET2Wi" target="_blank" rel="noopener">💬 카카오 오픈채팅으로 문의하기</a></p>
        <p className="muted small">회원 가입 없이 카카오톡으로 바로 이야기할 수 있습니다.</p>
      </div>

    </section>
  );
}
