// Exporta a animação como vídeo MP4 (H.264, sem áudio), o formato que o WhatsApp
// reconhece e reproduz em loop como GIF. Um "GIF" enviado como imagem vira figura
// estática no WhatsApp; um MP4 curto e mudo não.
//
// Caminho principal: WebCodecs (VideoEncoder H.264) + mp4-muxer. Gera o arquivo
// mais rápido que o tempo real, com taxa de quadros constante e yuv420p.
// Caminho reserva: MediaRecorder (só quando o navegador não tem H.264 em WebCodecs).
import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer.mjs';
import { drawSeqItem, gifDelay } from './render.js';

export const FPS = 30;
export const WHATSAPP_MAX_SECONDS = 6;

// Perfis H.264 do melhor para o mais compatível (High 4.0, Main 4.0, Baseline 3.1)
const H264 = [
  { wc: 'avc1.640028', mux: 'avc' },
  { wc: 'avc1.4d0028', mux: 'avc' },
  { wc: 'avc1.42001f', mux: 'avc' },
];
const VP9_TEST = { wc: 'vp09.00.10.08', mux: 'vp9' }; // só para testes automatizados

const even = (n) => n - (n % 2);

async function pickCodec(w, h, bitrate, allowVp9) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return null;
  for (const c of allowVp9 ? [...H264, VP9_TEST] : H264) {
    const cfg = { codec: c.wc, width: w, height: h, bitrate, framerate: FPS };
    if (c.mux === 'avc') cfg.avc = { format: 'avc' };
    try {
      const r = await VideoEncoder.isConfigSupported(cfg);
      if (r.supported) return { cfg, mux: c.mux };
    } catch { /* tenta o próximo */ }
  }
  return null;
}

/** true se o navegador consegue gerar MP4 H.264 pelo caminho principal. */
export async function canEncodeH264(W = 480, H = 480) {
  return !!(await pickCodec(even(W), even(H), 2e6, false));
}

/** Quantas vezes repetir a animação dentro do vídeo. */
export function videoPasses(perMs, loop) {
  const maxPasses = Math.max(1, Math.floor((WHATSAPP_MAX_SECONDS * 1000) / perMs));
  if (loop === 0) return Math.min(10, maxPasses);
  return Math.max(1, Math.min(loop, maxPasses));
}

const nextTick = () => new Promise((r) => setTimeout(r, 0));
const abortError = () => new DOMException('Cancelado', 'AbortError');

/**
 * @returns {Promise<{blob: Blob, ext: 'mp4', codec: string, seconds: number} | null>}
 *          null quando o navegador não suporta H.264 em WebCodecs.
 */
export async function encodeMp4({ seq, cache, W, H, passes, onProgress, signal, allowVp9 = false }) {
  const w = even(W);
  const h = even(H);
  const per = seq.reduce((a, it) => a + gifDelay(it.delay), 0);
  const totalMs = per * passes;
  // ~0,2 bit por pixel por quadro: nítido para animações curtas, arquivo pequeno
  const bitrate = Math.round(Math.min(8e6, Math.max(1e6, w * h * FPS * 0.2)));

  const picked = await pickCodec(w, h, bitrate, allowVp9);
  if (!picked) return null;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: picked.mux, width: w, height: h, frameRate: FPS },
    fastStart: 'in-memory', // moov no início: toca antes de baixar tudo e o WhatsApp lê melhor
    firstTimestampBehavior: 'offset',
  });

  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { failure = e; },
  });
  encoder.configure(picked.cfg);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  // início de cada item da sequência, em ms
  const starts = [];
  let acc = 0;
  for (const it of seq) { starts.push(acc); acc += gifDelay(it.delay); }

  const frames = Math.max(1, Math.round((totalMs / 1000) * FPS));
  let k = 0;
  try {
    for (let n = 0; n < frames; n++) {
      if (signal?.aborted) throw abortError();
      if (failure) throw failure;

      const t = ((n * 1000) / FPS) % per;
      if (t < starts[k]) k = 0; // voltou ao início da animação
      while (k + 1 < seq.length && starts[k + 1] <= t) k++;
      drawSeqItem(ctx, seq[k], cache);

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round((n * 1e6) / FPS),
        duration: Math.round(1e6 / FPS),
      });
      encoder.encode(frame, { keyFrame: n % (FPS * 2) === 0 });
      frame.close();

      // não deixa a fila do codificador crescer (memória) e mantém a tela responsiva
      while (encoder.encodeQueueSize > 8) await nextTick();
      if (n % 6 === 0) {
        onProgress?.(n / frames);
        await nextTick();
      }
    }
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  onProgress?.(1);
  return {
    blob: new Blob([target.buffer], { type: 'video/mp4' }),
    ext: 'mp4',
    codec: picked.mux === 'avc' ? 'H.264' : 'VP9',
    seconds: totalMs / 1000,
  };
}

// ------------------------------------------------------------------ caminho reserva
const RECORDER_TYPES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function recorderSupport() {
  if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return null;
  const mime = RECORDER_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mime) return null;
  const isMp4 = mime.startsWith('video/mp4');
  return { mime, ext: isMp4 ? 'mp4' : 'webm', whatsapp: isMp4 };
}

const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(abortError()); }, { once: true });
  });

/** Grava em tempo real com MediaRecorder. WebM não funciona no WhatsApp: só serve para baixar. */
export async function recordVideo({ seq, cache, W, H, passes, onProgress, signal }) {
  const sup = recorderSupport();
  if (!sup) throw new Error('Seu navegador não consegue gravar vídeo.');

  const canvas = document.createElement('canvas');
  canvas.width = even(W);
  canvas.height = even(H);
  const ctx = canvas.getContext('2d');
  drawSeqItem(ctx, seq[0], cache);

  const stream = canvas.captureStream(FPS);
  const rec = new MediaRecorder(stream, { mimeType: sup.mime, videoBitsPerSecond: 4_000_000 });
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
        await wait(Math.max(0, t0 + elapsed - performance.now()), signal); // relógio absoluto
        onProgress?.(elapsed / total);
      }
    }
  } finally {
    rec.stop();
    stream.getTracks().forEach((t) => t.stop());
    await stopped;
  }
  return {
    blob: new Blob(chunks, { type: sup.mime.split(';')[0] }),
    ext: sup.ext,
    codec: sup.ext === 'mp4' ? 'H.264' : 'VP9/VP8',
    seconds: total / 1000,
    whatsapp: sup.whatsapp,
  };
}
