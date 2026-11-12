// 操作反馈：Web Audio 合成的短音效 + 手机震动。没有音频文件，迁移到微信小游戏时换成
// wx.createInnerAudioContext / wx.vibrateShort 的实现即可，调用方不变。

export type FeedbackEvent = "collect" | "objective" | "miss" | "blocked" | "hint" | "complete" | "fail" | "tap";

interface Note {
  freq: number;
  start: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
}

const SOUNDS: Record<FeedbackEvent, Note[]> = {
  tap: [{ freq: 660, start: 0, duration: 0.05, type: "triangle", gain: 0.12 }],
  collect: [
    { freq: 880, start: 0, duration: 0.09, type: "triangle" },
    { freq: 1320, start: 0.07, duration: 0.12, type: "triangle" },
  ],
  objective: [
    { freq: 784, start: 0, duration: 0.1, type: "triangle" },
    { freq: 988, start: 0.08, duration: 0.1, type: "triangle" },
    { freq: 1319, start: 0.16, duration: 0.16, type: "triangle" },
  ],
  miss: [{ freq: 220, start: 0, duration: 0.16, type: "square", gain: 0.08 }],
  blocked: [{ freq: 180, start: 0, duration: 0.07, type: "sine", gain: 0.2 }],
  hint: [
    { freq: 1047, start: 0, duration: 0.12, type: "sine", gain: 0.15 },
    { freq: 1568, start: 0.1, duration: 0.18, type: "sine", gain: 0.12 },
  ],
  complete: [
    { freq: 523, start: 0, duration: 0.14, type: "triangle" },
    { freq: 659, start: 0.12, duration: 0.14, type: "triangle" },
    { freq: 784, start: 0.24, duration: 0.14, type: "triangle" },
    { freq: 1047, start: 0.36, duration: 0.3, type: "triangle" },
  ],
  fail: [
    { freq: 392, start: 0, duration: 0.18, type: "sawtooth", gain: 0.07 },
    { freq: 294, start: 0.16, duration: 0.3, type: "sawtooth", gain: 0.07 },
  ],
};

/** 震动时长（毫秒），不在表里的事件不震动 */
const VIBRATION: Partial<Record<FeedbackEvent, number | number[]>> = {
  miss: 30,
  blocked: 15,
  fail: [40, 60, 40],
  complete: [20, 40, 20],
};

class Feedback {
  enabled = true;
  private ctx: AudioContext | null = null;

  /** 浏览器要求在用户手势里创建/恢复音频，第一次点击时调用 */
  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  play(event: FeedbackEvent) {
    if (!this.enabled) return;
    this.unlock();
    const ctx = this.ctx;
    if (ctx) {
      const now = ctx.currentTime;
      for (const note of SOUNDS[event]) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = note.type ?? "sine";
        osc.frequency.value = note.freq;
        const peak = note.gain ?? 0.18;
        const t0 = now + note.start;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + note.duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + note.duration + 0.02);
      }
    }
    const pattern = VIBRATION[event];
    if (pattern && "vibrate" in navigator) navigator.vibrate(pattern);
  }
}

export const feedback = new Feedback();
