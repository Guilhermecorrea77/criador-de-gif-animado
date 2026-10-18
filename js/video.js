// Extração de quadros de um vídeo local (nada é enviado para servidor).

function once(el, ev, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('Não foi possível ler o vídeo.')); };
    // alguns navegadores não disparam "seeked" quando o tempo já é o pedido: não trava
    const timer = setTimeout(ok, timeout);
    const cleanup = () => { clearTimeout(timer); el.removeEventListener(ev, ok); el.removeEventListener('error', fail); };
    el.addEventListener(ev, ok, { once: true });
    el.addEventListener('error', fail, { once: true });
  });
}

/**
 * Extrai quadros entre start e end (segundos) na taxa fps.
 * @returns {Promise<Blob[]>}
 */
export async function extractFrames(video, { start, end, fps, maxFrames, maxSide = 1280, onProgress, signal }) {
  const duration = Math.max(0, end - start);
  const count = Math.min(maxFrames, Math.max(1, Math.floor(duration * fps) + 1));
  const step = count > 1 ? duration / (count - 1) : 0;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const scale = Math.min(1, maxSide / Math.max(vw, vh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vw * scale);
  canvas.height = Math.round(vh * scale);
  const ctx = canvas.getContext('2d');

  video.pause();
  const blobs = [];
  for (let i = 0; i < count; i++) {
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    const t = Math.min(video.duration - 0.001, start + i * step);
    const p = once(video, 'seeked');
    video.currentTime = t;
    await p;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    blobs.push(blob);
    onProgress?.((i + 1) / count);
  }
  return blobs;
}
