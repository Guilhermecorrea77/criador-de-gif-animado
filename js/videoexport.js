// Exporta a animação como vídeo (MP4 quando o navegador suporta, senão WebM).
import { drawSeqItem, gifDelay } from './render.js';

const TYPES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function videoSupport() {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  const mime = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mime) return null;
  return { mime, ext: mime.startsWith('video/mp4') ? 'mp4' : 'webm' };
}

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Cancelado', 'AbortError')); }, { once: true });
  });

/**
 * Grava a sequência em tempo real. passes = quantas vezes a animação é repetida no vídeo.
 * @returns {Promise<{blob: Blob, ext: string}>}
 */
export async function recordVideo({ seq, cache, W, H, passes, onProgress, signal }) {
  const sup = videoSupport();
  if (!sup) throw new Error('Seu navegador não grava vídeo.');

  const canvas = document.createElement('canvas');
  // codificadores de vídeo exigem dimensões pares
  canvas.width = W - (W % 2);
  canvas.height = H - (H % 2);
  const ctx = canvas.getContext('2d');
  drawSeqItem(ctx, seq[0], cache);

  const stream = canvas.captureStream(30);
  const rec = new MediaRecorder(stream, { mimeType: sup.mime, videoBitsPerSecond: 5_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => (rec.onstop = r));

  const per = seq.reduce((a, it) => a + gifDelay(it.delay), 0);
  const total = per * passes;
  let elapsed = 0;

  rec.start(250);
  const t0 = performance.now();
  try {
    for (let p = 0; p < passes; p++) {
      for (const item of seq) {
        drawSeqItem(ctx, item, cache);
        elapsed += gifDelay(item.delay);
        // agenda pelo relógio absoluto para não acumular atraso dos timers
        await wait(Math.max(0, t0 + elapsed - performance.now()), signal);
        onProgress?.(elapsed / total);
      }
    }
  } finally {
    rec.stop();
    stream.getTracks().forEach((t) => t.stop());
    await stopped;
  }
  return { blob: new Blob(chunks, { type: sup.mime.split(';')[0] }), ext: sup.ext };
}
