// 주보에 넣을 그림을 올리기 전에 이 컴퓨터에서 크기를 줄인다 (자료 파일·백업이 너무 커지지 않게)
// - 긴 쪽을 maxSide 픽셀 이하로 줄이고, 파일 크기가 maxBytes 이하가 되게 JPEG 품질을 낮춘다
// - 로고(keepPng)는 투명한 배경을 살리려고 먼저 PNG 로 해 보고, 너무 크면 흰 배경 JPEG 로 바꾼다
const bytesOf = (dataUrl: string) => Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4);

export async function shrinkImage(file: File, { maxSide = 1400, maxBytes = 600 * 1024, keepPng = false } = {}): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif|bmp|heic|heif)$/i.test(file.type) && !/\.(png|jpe?g|webp|gif|bmp|heic)$/i.test(file.name)) throw new Error('그림 파일(PNG·JPG 등)을 골라 주세요.');
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('이 그림 파일을 열지 못했습니다. PNG나 JPG로 저장한 뒤 다시 골라 주세요.'); }
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  if (keepPng) {
    ctx.drawImage(bmp, 0, 0, w, h);
    const png = c.toDataURL('image/png');
    if (bytesOf(png) <= maxBytes) return png;
    ctx.clearRect(0, 0, w, h);
  }
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) {
    const jpg = c.toDataURL('image/jpeg', q);
    if (bytesOf(jpg) <= maxBytes) return jpg;
  }
  throw new Error('그림을 충분히 줄이지 못했습니다. 더 작은 그림을 골라 주세요.');
}
