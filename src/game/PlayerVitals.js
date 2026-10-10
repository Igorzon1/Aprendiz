import { VITALS } from './configCombat.js';
import { Health } from './Health.js';
import { Emitter, wait } from './util.js';

/**
 * Vida da Aprendiz (5 pontos): barra na UI (só depois que ela ganha a varinha), 1 s de invencibilidade com
 * "pisca" depois de cada golpe, Hit/Defeat no Player. Eventos: 'changed', 'hurt', 'defeated'.
 */
export class PlayerVitals extends Emitter {
  /** @param {import('./Game.js').Game} game */
  constructor(game) {
    super();
    this.game = game;
    this.health = new Health(VITALS.maxHp);
    this.invuln = 0;
    this.lastResult = null;   // 'hurt' | 'dodged' | 'blocked' | 'invuln' (o último hit())
    this.defeated = false;
    this.shown = false;
    this._blinkT = 0;
    this._blinkOn = true;
    this.health.on('changed', () => { this._sync(); this.emit('changed', this.health.hp, this.health.max); });
  }

  get hp() { return this.health.hp; }
  get max() { return this.health.max; }

  /** Barra só aparece quando ela já tem a varinha. */
  _sync() {
    if (!this.game.state.flags.hasWand) return;
    this.shown = true;
    this.game.ui.setHP?.(this.health.hp, this.health.max);
  }

  update(dt) {
    if (!this.shown && this.game.state.flags.hasWand) this._sync();
    const model = this.game.player.model;
    if (this.invuln > 0 && !this.defeated) {
      this.invuln = Math.max(0, this.invuln - dt);
      this._blinkT -= dt;
      if (this._blinkT <= 0) { this._blinkT = VITALS.blinkEvery; this._blinkOn = !this._blinkOn; }
      model.visible = this.invuln > 0 ? this._blinkOn : true;
    } else if (!model.visible && !this.defeated) {
      model.visible = true;
    }
    if (this.invuln === 0 && !this._blinkOn) { this._blinkOn = true; model.visible = true; }
  }

  /** Um inimigo acertou. `from` = onde ele estava (empurra para longe). */
  hit(dmg, fromX, fromZ, { unblockable = false } = {}) {
    this.lastResult = 'invuln';
    if (this.defeated || this.invuln > 0) return false;
    const p = this.game.player;
    if (p.defeated) return false;
    if (p.iframes > 0) { this.lastResult = 'dodged'; this.emit('dodged'); return false; }              // esquiva: invencível
    if (!unblockable && p.blockCovers(fromX, fromZ)) {                                                // escudo: golpe frontal bloqueado
      if (p.blockHitCd <= 0) p.onBlocked(fromX, fromZ);
      this.lastResult = 'blocked';
      this.emit('blocked');
      return false;
    }
    if (!this.health.damage(dmg)) return false;
    this.lastResult = 'hurt';
    this.invuln = VITALS.invulnerable;
    this._blinkT = 0;
    this.game.enemies?.fx.hurtSpark(p.pos.x, p.pos.y + 0.5, p.pos.z);
    this.emit('hurt', this.health.hp);
    if (this.health.isDead) {
      this.defeated = true;
      this.emit('defeated');
      this.handleDefeat(() => this.game.respawnAfterDefeat());
    } else {
      p.hurt(fromX, fromZ);
    }
    return true;
  }

  /** Recompensa: +n de vida máxima (e enche a barra). */
  addMax(n = 1) {
    this.health.setMax(this.health.max + n, true);
  }

  heal(n = 1) {
    if (this.defeated) return 0;
    return this.health.heal(n);
  }

  /** Cura tudo e libera (depois de voltar para casa). */
  reset() {
    this.defeated = false;
    this.invuln = 0;
    this.game.player.model.visible = true;
    this.health.reset();
    this._sync();
  }

  /**
   * Fim de jogo "fofo": ela cai (Defeat), a tela escurece, `respawnFn` leva de volta à porta de casa, e a tela volta.
   * @param {() => (void|Promise<void>)} respawnFn
   */
  async handleDefeat(respawnFn) {
    const { player, ui } = this.game;
    this.game.input.clear();
    player.lock('defeat');
    player.model.visible = true;
    await Promise.race([player.defeat(), wait(VITALS.defeatMaxWait * 1000)]);
    await wait(VITALS.defeatHold * 1000);
    await ui.fade(1, VITALS.fadeMs);
    try { await respawnFn?.(); } finally {
      this.reset();
      player.unlock('defeat');
    }
    await ui.fade(0, VITALS.fadeMs);
  }
}

/** Atalho com a assinatura do contrato: handleDefeat(game, respawnFn). */
export function handleDefeat(game, respawnFn) {
  return game.vitals.handleDefeat(respawnFn);
}
