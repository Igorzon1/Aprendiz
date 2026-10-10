import { Emitter } from './util.js';

/**
 * Pontos de vida. Eventos:
 *  - `changed` (hp, max, delta)  a cada mudança (dano, cura, reset);
 *  - `dead`                      quando chega a 0 (uma vez por "vida").
 */
export class Health extends Emitter {
  constructor(max = 3) {
    super();
    this.max = max;
    this.hp = max;
  }

  get isDead() { return this.hp <= 0; }
  get fraction() { return this.max > 0 ? this.hp / this.max : 0; }

  /** Tira vida. Retorna o dano realmente aplicado (0 se já estava morto). */
  damage(n = 1) {
    if (this.isDead || n <= 0) return 0;
    const before = this.hp;
    this.hp = Math.max(0, this.hp - n);
    const delta = this.hp - before;
    this.emit('changed', this.hp, this.max, delta);
    if (this.hp <= 0) this.emit('dead');
    return -delta;
  }

  /** Cura. Não revive quem já morreu (para isso use reset). Retorna o quanto curou. */
  heal(n = 1) {
    if (this.isDead || n <= 0) return 0;
    const before = this.hp;
    this.hp = Math.min(this.max, this.hp + n);
    const delta = this.hp - before;
    if (delta !== 0) this.emit('changed', this.hp, this.max, delta);
    return delta;
  }

  /** Volta ao máximo (ou a `hp`), inclusive revivendo. */
  reset(hp = this.max) {
    const before = this.hp;
    this.hp = Math.min(this.max, Math.max(0, hp));
    if (this.hp !== before) this.emit('changed', this.hp, this.max, this.hp - before);
  }

  setMax(max, fill = true) {
    this.max = max;
    this.hp = fill ? max : Math.min(this.hp, max);
    this.emit('changed', this.hp, this.max, 0);
  }
}
