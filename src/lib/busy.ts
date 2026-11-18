// 지금 손이 가는 작업(녹음·저장 중 등)이 있는지. 있으면 업데이트 안내 창을 저절로 띄우지 않는다.
const keys = new Set<string>();
export function setBusy(key: string, on: boolean) { if (on) keys.add(key); else keys.delete(key); }
export const busyNow = () => keys.size > 0;
