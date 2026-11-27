// 대화 창(편집 창) 공통 키보드·화면 읽기 도우미. 앱 맨 위에서 한 번 켠다.
// - Escape: 맨 위 창의 어두운 바깥을 누른 것과 같다 (저장 안 한 입력이 있으면 똑같이 묻는다. 녹음 중처럼 바깥 누르기가 막힌 창은 닫히지 않음)
// - 창이 열리면 창 안으로 초점을 옮기고, 닫히면 열기 전 자리로 돌려 놓는다
// - 창 제목(h2)을 창 이름으로 이어 준다 (화면 읽기 프로그램용)
let seq = 0;
export function installDialogA11y(doc: Document = document) {
  const opened = new Map<Element, Element | null>();
  const label = (d: Element) => {
    const h = d.querySelector('h2, h3');
    if (h && !d.getAttribute('aria-labelledby')) { if (!h.id) h.id = `dlg-title-${++seq}`; d.setAttribute('aria-labelledby', h.id); }
  };
  const sync = () => {
    const now = [...doc.querySelectorAll('[role="dialog"]')];
    for (const d of now) if (!opened.has(d)) {
      opened.set(d, doc.activeElement);
      label(d);
      if (!d.contains(doc.activeElement)) {
        const first = d.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])');
        if (first) first.focus({ preventScroll: true });
        else { (d as HTMLElement).tabIndex = -1; (d as HTMLElement).focus({ preventScroll: true }); }
      }
    }
    for (const [d, back] of [...opened]) if (!d.isConnected) {
      opened.delete(d);
      if (back instanceof HTMLElement && back.isConnected && !doc.querySelector('[role="dialog"]')) back.focus({ preventScroll: true });
    }
  };
  const mo = new MutationObserver(sync);
  mo.observe(doc.body, { childList: true, subtree: true });
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || e.isComposing) return;
    const backs = [...doc.querySelectorAll<HTMLElement>('.dialog-back')];
    const top = backs[backs.length - 1];
    if (!top) return;
    e.preventDefault();
    top.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };
  doc.addEventListener('keydown', onKey);
  return () => { mo.disconnect(); doc.removeEventListener('keydown', onKey); };
}

/** 누를 수 있는 표의 줄·목록 칸을 키보드로도 열게 (Tab 으로 가서 Enter·Space) */
export const clickable = (onActivate: () => void) => ({
  role: 'button' as const,
  tabIndex: 0,
  onClick: onActivate,
  onKeyDown: (e: { key: string; target: EventTarget; currentTarget: EventTarget; preventDefault: () => void }) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onActivate(); }
  },
});
