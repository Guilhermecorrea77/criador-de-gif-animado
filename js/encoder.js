// Codificação do GIF com gif.js (Web Workers, não trava a interface).
import { drawSeqItem, gifDelay } from './render.js';

const QUALITY = { high: 1, medium: 10, low: 20 };

/**
 * @returns {{ promise: Promise<Blob>, abort: () => void }}
 */
export function encodeGif({ seq, cache, W, H, settings, onProgress }) {
  /* global GIF */
  if (typeof GIF === 'undefined') {
    return { promise: Promise.reject(new Error('Biblioteca gif.js não carregou.')), abort() {} };
  }

  const gif = new GIF({
    workers: Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 2) - 1)),
    quality: QUALITY[settings.quality] ?? 10,
    dither: settings.dither ? 'FloydSteinberg' : false,
    workerScript: 'vendor/gif.worker.js',
    width: W,
    height: H,
    // gif.js: 0 = infinito, -1 = toca uma vez, n = repete n vezes
    repeat: settings.loop === 0 ? 0 : settings.loop === 1 ? -1 : settings.loop - 1,
    background: settings.bg,
  });

  const scratch = document.createElement('canvas');
  scratch.width = W;
  scratch.height = H;
  const ctx = scratch.getContext('2d', { willReadFrequently: true });

  for (const item of seq) {
    drawSeqItem(ctx, item, cache);
    gif.addFrame(ctx, { copy: true, delay: gifDelay(item.delay) });
  }

  let aborted = false;
  const promise = new Promise((resolve, reject) => {
    gif.on('progress', (p) => onProgress?.(p));
    gif.on('finished', (blob) => resolve(blob));
    gif.on('abort', () => reject(new DOMException('Cancelado', 'AbortError')));
    gif.render();
  });

  return {
    promise,
    abort() {
      if (aborted) return;
      aborted = true;
      gif.abort();
    },
  };
}
