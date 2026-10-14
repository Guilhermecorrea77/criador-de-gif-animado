// Captura de fotos pela câmera (foto única ou sequência com contagem regressiva).

export const hasCamera = () => !!navigator.mediaDevices?.getUserMedia;

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.facing = 'user';
  }

  get mirrored() {
    return this.facing === 'user';
  }

  async start() {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: this.facing, width: { ideal: 1280 }, height: { ideal: 960 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    this.video.classList.toggle('is-mirrored', this.mirrored);
    await this.video.play();
  }

  async flip() {
    this.facing = this.facing === 'user' ? 'environment' : 'user';
    await this.start();
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  /** Tira uma foto (espelhada na câmera frontal, como aparece na tela). */
  async snap(maxSide = 1280) {
    const v = this.video;
    const k = Math.min(1, maxSide / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * k);
    c.height = Math.round(v.videoHeight * k);
    const ctx = c.getContext('2d');
    if (this.mirrored) {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0, c.width, c.height);
    return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
  }
}
