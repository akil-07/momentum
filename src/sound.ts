import { getState } from './store'

let ctx: AudioContext | null = null
const ac = () => (ctx ??= new AudioContext())
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24]

function tone(freq: number, at: number, len = 0.14, type: OscillatorType = 'sine', vol = 0.18) {
  const a = ac(), o = a.createOscillator(), g = a.createGain()
  o.type = type; o.frequency.setValueAtTime(freq, a.currentTime + at)
  g.gain.setValueAtTime(0, a.currentTime + at)
  g.gain.linearRampToValueAtTime(vol, a.currentTime + at + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + at + len)
  o.connect(g).connect(a.destination); o.start(a.currentTime + at); o.stop(a.currentTime + at + len + 0.05)
}
const hz = (semi: number) => 523.25 * Math.pow(2, semi / 12)

export const sfx = {
  on: () => getState().settings.sound,
  check(combo = 1) { if (!this.on()) return; const b = Math.min(combo - 1, 6); tone(hz(PENTA[b]), 0, 0.12, 'triangle'); tone(hz(PENTA[b + 2]), 0.07, 0.2, 'triangle') },
  level() { if (!this.on()) return; [0, 4, 7, 12, 7, 12, 16, 24].forEach((s, i) => tone(hz(s - 12), i * 0.09, 0.3, 'triangle', 0.16)) },
  tap() { if (!this.on()) return; tone(hz(12), 0, 0.05, 'sine', 0.08) },
  undo() { if (!this.on()) return; tone(hz(7), 0, 0.08, 'sine', 0.1); tone(hz(0), 0.06, 0.14, 'sine', 0.1) },
  tick() { if (!this.on()) return; tone(hz(24), 0, 0.04, 'sine', 0.05) },
}
export function buzz(p: number | number[]) { if (getState().settings.haptics && 'vibrate' in navigator && navigator.userActivation?.hasBeenActive !== false) navigator.vibrate(p) }
