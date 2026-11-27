export class ApiError extends Error {
  constructor(public status: number, message: string, public data: any = null) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, '라온 교회 올인원 프로그램과 연결이 끊겼습니다. 프로그램이 켜져 있는지 확인해 주세요.');
  }
  const j = await r.json().catch(() => ({}));
  // 잠긴 자료(성도·재정·행정)면 잠금 화면을 띄우게 알린다
  if (r.status === 423) window.dispatchEvent(new Event('allinone-locked'));
  if (!r.ok) throw new ApiError(r.status, j.error || `요청을 처리하지 못했습니다 (${r.status})`, j);
  return j as T;
}

/** 성도 자료: 성도만 잠겨 있으면(423) 빈 명부로 돌려준다. 재정·행정처럼 잠기지 않은 화면은 그대로 쓰고, 성도 이름·주소만 가린다 */
export async function peopleOrLocked<T extends { members: unknown[] }>(base: string, empty: T): Promise<T & { peopleLocked?: boolean }> {
  try { return await api<T>(`${base}/people`); }
  catch (e) { if (e instanceof ApiError && e.status === 423) return { ...empty, peopleLocked: true }; throw e; }
}
