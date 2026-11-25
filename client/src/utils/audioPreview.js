/**
 * Lightweight Web Audio API synthesizer matching the built-in FFmpeg ambient score
 * (Am9 <-> Fmaj7 warm low-passed pad) so users can preview the score before rendering.
 */
class AmbientPreviewPlayer {
  constructor() {
    this.ctx = null;
    this.timer = null;
    this.nodes = [];
    this.playing = false;
  }

  start() {
    if (this.playing) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error('Audio preview is not supported in this browser.');

    const ctx = new AudioCtx();
    this.ctx = ctx;
    this.playing = true;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0.001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + 1.2);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;

    filter.connect(master);
    master.connect(ctx.destination);
    this.nodes.push(master, filter);

    const chordA = [110, 164.81, 220, 261.63, 329.63, 493.88]; // Am9
    const chordB = [87.31, 130.81, 174.61, 261.63, 329.63, 440]; // Fmaj7

    const oscs = chordA.map((freq, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      g.gain.value = i < 2 ? 0.22 : 0.12;
      osc.connect(g);
      g.connect(filter);
      osc.start();
      this.nodes.push(osc, g);
      return osc;
    });

    let step = 0;
    this.timer = window.setInterval(() => {
      if (!this.ctx || !this.playing) return;
      step = 1 - step;
      const target = step === 0 ? chordA : chordB;
      const now = this.ctx.currentTime;
      oscs.forEach((osc, i) => {
        osc.frequency.setTargetAtTime(target[i], now, 1.1);
      });
    }, 4000);
  }

  stop() {
    this.playing = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ctx) {
      try {
        this.ctx.close();
      } catch { /* ignore */ }
      this.ctx = null;
    }
    this.nodes = [];
  }
}

export const ambientPreview = new AmbientPreviewPlayer();
