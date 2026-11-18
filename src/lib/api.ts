export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
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
  if (!r.ok) throw new ApiError(r.status, j.error || `요청을 처리하지 못했습니다 (${r.status})`);
  return j as T;
}
