// Pipeline de renderização: recorte → enquadramento → filtros → texto.
// Usado tanto pela pré-visualização quanto pela exportação, garantindo
// que o GIF final fique idêntico ao que aparece na tela.

export const ASPECTS = {
  original: null,
  '1:1': 1,
  '4:3': 4 / 3,
  '3:4': 3 / 4,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
};

// Matrizes de cor 3x3 (linhas = R, G, B de saída)
const PRESETS = {
  none: null,
  bw: [0.299, 0.587, 0.114, 0.299, 0.587, 0.114, 0.299, 0.587, 0.114],
  sepia: [0.393, 0.769, 0.189, 0.349, 0.686, 0.168, 0.272, 0.534, 0.131],
  vintage: [0.6, 0.35, 0.1, 0.25, 0.65, 0.1, 0.2, 0.3, 0.45],
  cold: [0.9, 0, 0, 0, 1, 0, 0, 0.05, 1.15],
  warm: [1.15, 0.05, 0, 0, 1, 0, 0, 0, 0.85],
  vivid: null, // tratado como saturação extra
};

/** Desenha a imagem já com rotação/espelhamento e recorte aplicados. */
export function getCroppedSource(frame) {
  const c = frame.crop;
  if (!c) return frame.img;
  if (frame._cropCache && frame._cropKey === JSON.stringify(c)) return frame._cropCache;

  const img = frame.img;
  const rot = ((c.rotate || 0) % 360 + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const rw = swap ? img.naturalHeight : img.naturalWidth;
  const rh = swap ? img.naturalWidth : img.naturalHeight;

  // Coordenadas relativas permitem aplicar o mesmo recorte a imagens de tamanhos diferentes
  const x = Math.round(c.rx * rw);
  const y = Math.round(c.ry * rh);
  const w = Math.max(1, Math.round(c.rw * rw));
  const h = Math.max(1, Math.round(c.rh * rh));

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.translate(-x, -y);
  ctx.translate(rw / 2, rh / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(c.scaleX || 1, c.scaleY || 1);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);

  frame._cropCache = out;
  frame._cropKey = JSON.stringify(c);
  return out;
}

function srcSize(src) {
  return {
    w: src.naturalWidth || src.width,
    h: src.naturalHeight || src.height,
  };
}

/** Calcula as dimensões finais do GIF a partir das configurações. */
export function outputSize(frames, s) {
  let ratio = ASPECTS[s.aspect];
  if (!ratio) {
    const first = frames[0] ? srcSize(getCroppedSource(frames[0])) : { w: 1, h: 1 };
    ratio = first.w / first.h;
  }
  const W = Math.round(s.width);
  // GIF com dimensões pares evita artefatos em alguns players
  const H = Math.max(2, Math.round(W / ratio / 2) * 2);
  return { W, H };
}

function buildMatrix(s) {
  // Começa com identidade
  let m = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const p = PRESETS[s.filter];
  if (p) m = p.slice();

  let sat = 1 + s.saturation / 100;
  if (s.filter === 'vivid') sat *= 1.45;
  if (sat !== 1) {
    const lr = 0.2126, lg = 0.7152, lb = 0.0722;
    const S = [
      lr * (1 - sat) + sat, lg * (1 - sat), lb * (1 - sat),
      lr * (1 - sat), lg * (1 - sat) + sat, lb * (1 - sat),
      lr * (1 - sat), lg * (1 - sat), lb * (1 - sat) + sat,
    ];
    m = mul(S, m);
  }
  return m;
}

function mul(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return r;
}

const IDENTITY = '1,0,0,0,1,0,0,0,1';

/** Aplica filtros por pixel (funciona em todos os navegadores, inclusive Safari). */
function applyFilters(ctx, W, H, s) {
  const m = buildMatrix(s);
  const bright = s.brightness * 2.55; // -100..100 → -255..255
  const cf = s.contrast;
  const k = (259 * (cf + 255)) / (255 * (259 - cf)); // fórmula clássica de contraste
  const hasColor = m.join(',') !== IDENTITY;
  if (!hasColor && !bright && !cf) return;

  const data = ctx.getImageData(0, 0, W, H);
  const d = data.data;
  const [a, b, c, e, f, g, h, i, j] = m;
  for (let p = 0; p < d.length; p += 4) {
    let r = d[p], gr = d[p + 1], bl = d[p + 2];
    if (hasColor) {
      const nr = a * r + b * gr + c * bl;
      const ng = e * r + f * gr + g * bl;
      const nb = h * r + i * gr + j * bl;
      r = nr; gr = ng; bl = nb;
    }
    if (cf) {
      r = k * (r - 128) + 128;
      gr = k * (gr - 128) + 128;
      bl = k * (bl - 128) + 128;
    }
    d[p] = r + bright; // Uint8ClampedArray limita a 0..255 automaticamente
    d[p + 1] = gr + bright;
    d[p + 2] = bl + bright;
  }
  ctx.putImageData(data, 0, 0);
}

function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    let line = '';
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) {
        out.push(line);
        line = w;
      } else line = test;
    }
    out.push(line);
  }
  return out;
}

function drawText(ctx, W, H, t) {
  const text = (t.content || '').trim();
  if (!text) return;
  const size = Math.max(10, Math.round((W * t.size) / 100));
  ctx.font = `900 ${size}px Impact, "Anton", "Arial Black", "Helvetica Neue", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';

  const pad = Math.round(size * 0.5);
  const lines = wrapLines(ctx, text, W - pad * 2);
  const lh = size * 1.12;
  const blockH = lh * lines.length;
  let y0;
  if (t.position === 'top') y0 = pad + lh / 2;
  else if (t.position === 'middle') y0 = H / 2 - blockH / 2 + lh / 2;
  else y0 = H - pad - blockH + lh / 2;

  lines.forEach((line, n) => {
    const y = y0 + n * lh;
    if (t.outline) {
      ctx.lineWidth = Math.max(2, size / 7);
      ctx.strokeStyle = t.color.toLowerCase() === '#000000' ? '#ffffff' : '#000000';
      ctx.strokeText(line, W / 2, y);
    }
    ctx.fillStyle = t.color;
    ctx.fillText(line, W / 2, y);
  });
}

/** Renderiza um quadro completo no tamanho final. */
export function renderFrame(frame, W, H, s, target) {
  const canvas = target || document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  ctx.fillStyle = s.bg;
  ctx.fillRect(0, 0, W, H);

  const src = getCroppedSource(frame);
  const { w: sw, h: sh } = srcSize(src);
  const scale = s.fit === 'contain' ? Math.min(W / sw, H / sh) : Math.max(W / sw, H / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);

  applyFilters(ctx, W, H, s);
  drawText(ctx, W, H, s.text);
  return canvas;
}

/**
 * Monta a sequência final de reprodução.
 * Cada item: { a: índice do quadro, b: índice do próximo (ou null), t: mistura 0..1, delay }
 */
export function buildSequence(frames, s) {
  if (!frames.length) return [];
  const base = frames.map((f, i) => i);
  let order = s.reverse ? base.slice().reverse() : base;
  if (s.boomerang && order.length > 2) {
    // [A,B,C,D] → [A,B,C,D,C,B]; o loop volta para A sem repetir quadro
    order = order.concat(order.slice(1, -1).reverse());
  } else if (s.boomerang && order.length === 2) {
    order = order.slice();
  }

  const defaultDelay = 1000 / s.fps;
  const seq = [];
  const fade = s.transition === 'fade' && order.length > 1;
  const steps = fade ? s.transitionSteps : 0;
  const wraps = s.loop === 0; // só faz transição do último para o primeiro se repetir

  order.forEach((idx, n) => {
    const f = frames[idx];
    const hold = Math.max(20, f.delay || defaultDelay);
    const next = order[n + 1] ?? (wraps ? order[0] : null);

    if (fade && next !== null && next !== undefined) {
      const transMs = Math.min(s.transitionMs, hold * 0.8);
      seq.push({ a: idx, b: null, t: 0, delay: Math.max(20, hold - transMs) });
      const stepMs = Math.max(20, transMs / steps);
      for (let k = 1; k <= steps; k++) {
        seq.push({ a: idx, b: next, t: k / (steps + 1), delay: stepMs });
      }
    } else {
      seq.push({ a: idx, b: null, t: 0, delay: hold });
    }
  });
  return seq;
}

/** Desenha um item da sequência (com mistura, se houver) em ctx. */
export function drawSeqItem(ctx, item, cache) {
  const A = cache[item.a];
  if (!A) return;
  ctx.globalAlpha = 1;
  ctx.drawImage(A, 0, 0);
  if (item.b !== null && cache[item.b]) {
    ctx.globalAlpha = item.t;
    ctx.drawImage(cache[item.b], 0, 0);
    ctx.globalAlpha = 1;
  }
}

/** GIF usa centésimos de segundo; arredonda para o valor que será gravado. */
export function gifDelay(ms) {
  return Math.max(20, Math.round(ms / 10) * 10);
}
