// Funções matemáticas e utilitários pequenos usados em todo o jogo.
export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
// Sorteia um item sem repetir o último sorteado da MESMA lista (guarda o índice por array).
const _lastPick = new WeakMap();
export const pick = (arr) => {
  if (arr.length < 2) return arr[0];
  const last = _lastPick.get(arr);
  let i;
  do { i = Math.floor(Math.random() * arr.length); } while (i === last);
  _lastPick.set(arr, i);
  return arr[i];
};
export const smoothstep = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

/** Amortecimento exponencial independente de framerate. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Move `v` em direção a `target` no máximo `maxDelta`. */
export function approach(v, target, maxDelta) {
  if (v < target) return Math.min(v + maxDelta, target);
  return Math.max(v - maxDelta, target);
}

/** Diferença angular mais curta de a para b, em (-PI, PI]. */
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  else if (d <= -Math.PI) d += TAU;
  return d;
}

/** Gira `a` em direção a `b` com amortecimento exponencial (suave). */
export const dampAngle = (a, b, lambda, dt) => a + angleDiff(a, b) * (1 - Math.exp(-lambda * dt));

/** Gira `a` em direção a `b` com velocidade angular máxima. */
export function turnToward(a, b, maxStep) {
  const d = angleDiff(a, b);
  return Math.abs(d) <= maxStep ? b : a + Math.sign(d) * maxStep;
}

/** Yaw (rotação em Y) de um vetor no plano XZ; personagens olham para +Z com yaw 0. */
export const yawOf = (dx, dz) => Math.atan2(dx, dz);

/** Escolha ponderada: items = [[valor, peso], ...]. */
export function weightedPick(items) {
  let total = 0;
  for (const [, w] of items) total += Math.max(0, w);
  if (total <= 0) return items.length ? items[0][0] : null;
  let r = Math.random() * total;
  for (const [v, w] of items) {
    r -= Math.max(0, w);
    if (r <= 0) return v;
  }
  return items[items.length - 1][0];
}

export const easeOutBack = (t, s = 1.4) => { const c3 = s + 1; return 1 + c3 * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); };
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Emissor de eventos minimalista. */
export class Emitter {
  constructor() { this._l = {}; }
  on(type, fn) { (this._l[type] ||= []).push(fn); return this; }
  off(type, fn) { const a = this._l[type]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } return this; }
  emit(type, ...args) { const a = this._l[type]; if (a) for (const fn of a.slice()) fn(...args); }
}

/** Espera `ms` milissegundos. */
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
