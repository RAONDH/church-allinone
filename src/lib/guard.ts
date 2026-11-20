// 편집 창 공통: 저장하지 않은 입력이 있으면 닫기 전에 묻는다
// - 창 안에서 글을 쓰거나 고르면(input·change) '입력 있음'으로 본다
// - 바깥(어두운 곳)을 누르거나 [닫기]·[취소]로 닫을 때, 입력이 있으면 확인 창을 띄운다
// - 입력이 남아 있는 동안 브라우저 탭을 닫으려 하면 브라우저가 한 번 더 묻는다
// 저장에 성공해 창을 닫는 경로(onSaved 등)는 이 확인을 거치지 않는다.
import { useCallback, useEffect, useRef } from 'react';

export const UNSAVED_MSG = '저장하지 않은 입력이 있습니다. 닫으면 입력한 내용이 사라집니다. 닫을까요?';

export function useGuardedClose(onClose: () => void, extraDirty?: () => boolean) {
  const dirty = useRef(false);
  const isDirty = useCallback(() => dirty.current || !!extraDirty?.(), [extraDirty]);
  const close = useCallback(() => {
    if (isDirty() && !window.confirm(UNSAVED_MSG)) return;
    onClose();
  }, [onClose, isDirty]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => { if (isDirty()) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, [isDirty]);
  const mark = () => { dirty.current = true; };
  return {
    close,
    /** 창 안쪽 div 에 펼쳐 넣기: 입력을 감지한다 */
    track: { onInputCapture: mark, onChangeCapture: mark },
    /** 저장한 뒤에도 창을 열어 두는 경우 '입력 없음'으로 되돌린다 */
    clean: () => { dirty.current = false; },
  };
}
