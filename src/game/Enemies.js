import * as THREE from 'three';
import { CombatFx } from './CombatFx.js';
import { BOLT_HIT } from './configCombat.js';
import { Enemy, loadSombritoAsset } from './Enemy.js';
import { ST } from './EnemyBrain.js';
import { Emitter } from './util.js';

/**
 * Gerenciador dos Sombritos: cria os inimigos a partir dos nós ENEMY_* do mapa, atualiza, e serve de
 * "contexto" para o Enemy / EnemyBrain (alvo, colisão, navegação, efeitos, vida da Aprendiz).
 * Evento: 'killed' (enemy).
 */
export class Enemies extends Emitter {
  /** @param {import('./Game.js').Game} game */
  constructor(game) {
    super();
    this.game = game;
    this.list = [];
    this.fx = new CombatFx(game);
    this.asset = null;
    this.vitals = null;       // PlayerVitals (o Game liga)
    this._threats = [];
    this._pending = null;
    this._targetOut = { x: 0, z: 0 };
  }

  get collision() { return this.game.collision; }
  get nav() { return this.game.nav; }

  /** Carrega o modelo (ShadowMinion.glb) uma vez. */
  async load() {
    this.asset = await loadSombritoAsset(this.game.assets);
    if (this._pending) { const n = this._pending; this._pending = null; this.spawnFromNodes(n); }
    return this;
  }

  // ----- ciclo de vida -----------------------------------------------------------------------------
  /**
   * @param {{id:string, x:number, z:number, yaw?:number, territory?:number}[]} nodes
   */
  spawnFromNodes(nodes) {
    this.clear();
    if (!this.asset) { this._pending = nodes; return; }
    for (const n of nodes) {
      const e = new Enemy(this, this.asset, n);
      this.game.scene.add(e.root);
      this.list.push(e);
    }
  }

  /** Remove todos (troca de cenário). */
  clear() {
    for (const e of this.list) e.dispose();
    this.list = [];
    this._threats = [];
    this.fx.clear();
  }

  update(dt) {
    for (const e of this.list) e.update(dt);
    this.fx.update(dt);
  }

  /** Esconde / mostra todos sem destruir. */
  setActive(on) {
    for (const e of this.list) e.root.visible = on && e.brain.state !== ST.DEAD;
  }

  // ----- contexto do Enemy / EnemyBrain -------------------------------------------------------------
  /** Posição da Aprendiz como alvo (ou null: caída / sem controle). */
  target() {
    const p = this.game.player;
    if (!p || p.defeated || this.vitals?.defeated) return null;
    this._targetOut.x = p.pos.x;
    this._targetOut.z = p.pos.z;
    return this._targetOut;
  }

  playerPos() {
    const p = this.game.player;
    return p && !p.defeated ? p.pos : null;
  }

  /** Outros inimigos "sólidos" (para a separação). */
  neighborsOf(enemy) {
    return this.list.filter((o) => o !== enemy && o.brain.targetable);
  }

  notifyKilled(enemy) {
    this.emit('killed', enemy);
  }

  // ----- consultas (combate, gatos) ------------------------------------------------------------------
  /**
   * Dano em área esférica/cilíndrica: o primeiro inimigo dentro de `radius` (XZ) de `pos` (e na faixa de altura) leva `dmg`.
   * @returns {boolean} acertou alguém?
   */
  damageAt(pos, radius, dmg, fromPos = null) {
    let best = null, bd = Infinity;
    for (const e of this.list) {
      if (!e.targetable) continue;
      const dy = pos.y - e.pos.y;
      if (dy < BOLT_HIT.minY || dy > BOLT_HIT.maxY) continue;
      const d = Math.hypot(pos.x - e.pos.x, pos.z - e.pos.z);
      if (d <= e.radius + radius + BOLT_HIT.padXZ && d < bd) { bd = d; best = e; }
    }
    if (!best) return false;
    best.damage(dmg, fromPos ? fromPos.x : null, fromPos ? fromPos.z : null);
    return true;
  }

  /** Inimigo vivo mais próximo de pos (XZ) até maxDist, ou null. */
  nearest(pos, maxDist = Infinity) {
    let best = null, bd = maxDist;
    for (const e of this.list) {
      if (!e.targetable) continue;
      const d = Math.hypot(pos.x - e.pos.x, pos.z - e.pos.z);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /** Posições {x, z} dos inimigos que ameaçam (vivos e visíveis): os gatos evitam estas. */
  threatPositions() {
    const out = this._threats;
    out.length = 0;
    for (const e of this.list) {
      const s = e.brain.state;
      if (s === ST.DEAD || s === ST.DIE) continue;
      out.push(e.pos);
    }
    return out;
  }
}

void THREE;
