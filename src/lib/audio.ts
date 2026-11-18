// 브라우저 녹음 → 16kHz 모노 WAV (whisper 가 바로 읽는 형식). 녹음 파일(m4a 등)도 같은 형식으로 바꾼다.
import { setBusy } from './busy';
const RATE = 16000;

function wavBlob(chunks: Int16Array[], rate = RATE) {
  const n = chunks.reduce((s, c) => s + c.length, 0);
  const h = new DataView(new ArrayBuffer(44));
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) h.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); h.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true); h.setUint32(24, rate, true);
  h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); w(36, 'data'); h.setUint32(40, n * 2, true);
  return new Blob([h.buffer, ...chunks.map((c) => c.buffer as ArrayBuffer)], { type: 'audio/wav' });
}
const toInt16 = (f: Float32Array) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); o[i] = s < 0 ? s * 0x8000 : s * 0x7fff; } return o; };

/** 단순 선형 보간으로 rate → 16k */
function resample(f: Float32Array, rate: number) {
  if (rate === RATE) return f;
  const ratio = rate / RATE, out = new Float32Array(Math.floor(f.length / ratio));
  for (let i = 0; i < out.length; i++) { const x = i * ratio, a = Math.floor(x), t = x - a; out[i] = f[a] * (1 - t) + (f[a + 1] ?? f[a]) * t; }
  return out;
}

export class Recorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Int16Array[] = [];
  private samples = 0;
  private paused = false;
  constructor(private onTick: (seconds: number, level: number) => void) {}
  async start() {
    setBusy('recording', true);   // 녹음하는 동안은 업데이트 안내 창을 띄우지 않음
    try { this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) { setBusy('recording', false); throw e; }
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    const rate = this.ctx.sampleRate;
    this.node.onaudioprocess = (e) => {
      const f = e.inputBuffer.getChannelData(0);
      let sum = 0; for (let i = 0; i < f.length; i += 8) sum += f[i] * f[i];
      const level = Math.sqrt(sum / (f.length / 8));
      if (!this.paused) { const r = resample(new Float32Array(f), rate); this.chunks.push(toInt16(r)); this.samples += r.length; }
      this.onTick(this.samples / RATE, this.paused ? 0 : level);
    };
    src.connect(this.node);
    this.node.connect(this.ctx.destination);   // 소리는 나지 않음 (출력은 비어 있음)
  }
  pause() { this.paused = true; }
  resume() { this.paused = false; }
  private close() { setBusy('recording', false); this.node?.disconnect(); this.stream?.getTracks().forEach((t) => t.stop()); this.ctx?.close(); this.node = null; this.stream = null; this.ctx = null; }
  stop() { this.close(); const b = wavBlob(this.chunks); this.chunks = []; return b; }
  cancel() { this.close(); this.chunks = []; }
}

/** whisper 가 바로 못 읽는 형식인지 (m4a·aac·webm·mp4·wma 등) */
export const needsConvert = (name: string) => !/\.(wav|mp3|ogg|flac)$/i.test(name);

/** 녹음 파일을 브라우저에서 풀어 16kHz 모노 WAV 로 */
export async function decodeToWav(file: File) {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const ch = buf.numberOfChannels, len = buf.length, mono = new Float32Array(len);
    for (let c = 0; c < ch; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += d[i] / ch; }
    const r = resample(mono, buf.sampleRate);
    const parts: Int16Array[] = [];
    for (let i = 0; i < r.length; i += 1 << 20) parts.push(toInt16(r.subarray(i, i + (1 << 20))));
    return wavBlob(parts);
  } finally { ctx.close(); }
}
