// Leitura de GIFs animados quadro a quadro (WebCodecs ImageDecoder).
// Em navegadores sem suporte, retorna null e o app usa só o primeiro quadro.

export const canDecodeGif = () => typeof window.ImageDecoder === 'function';

/**
 * @returns {Promise<{blob: Blob, delay: number}[] | null>}
 */
export async function decodeGif(blob, maxFrames) {
  if (!canDecodeGif()) return null;
  try {
    if (!(await ImageDecoder.isTypeSupported('image/gif'))) return null;
    const dec = new ImageDecoder({ data: await blob.arrayBuffer(), type: 'image/gif' });
    await dec.tracks.ready;
    await dec.completed;
    const total = dec.tracks.selectedTrack.frameCount;
    if (total <= 1) { dec.close(); return null; }

    const n = Math.min(total, maxFrames);
    const out = [];
    let canvas, ctx;
    for (let i = 0; i < n; i++) {
      const { image } = await dec.decode({ frameIndex: i });
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.width = image.displayWidth;
        canvas.height = image.displayHeight;
        ctx = canvas.getContext('2d');
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      // duration vem em microssegundos; GIFs sem atraso costumam ser exibidos a 100 ms
      const ms = image.duration ? Math.round(image.duration / 1000) : 100;
      image.close();
      const b = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      b.name = `gif-${i + 1}.png`;
      out.push({ blob: b, delay: Math.max(20, ms) });
    }
    dec.close();
    return out;
  } catch {
    return null;
  }
}
