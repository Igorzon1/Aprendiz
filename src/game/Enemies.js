import * as THREE from 'three';
import { CombatFx } from './CombatFx.js';
import { BOLT_HIT, DECOY_BIAS, SHIELD_PUSH, SOMBRITO, SOMBRITO_VARIANTS, SPIT } from './configCombat.js';
import { Enemy, loadSombritoAsset } from './Enemy.js';
import { ST } from './EnemyBrain.js';
import { Emitter, rand } from './util.js';

const VARIANTS = ['base', 'brute', 'spitter'];
const modelOf = (v) => (SOMBRITO_VARIANTS[v]?.model ?? SOMBRITO.model);

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
    this.extras = [];         // alvos "tipo inimigo" extras: chefe, espinheiros ({pos, radius, targetable, accepts(src), damage()})
    this._pending = null;
    this._targetOut = { x: 0, z: 0 };
    this.assets = {};         // variant -> asset
    this.shots = [];          // Cuspidor's spit balls
    this.marks = [];          // ground telegraphs (Sombrão's slam)
    this._ringGeo = new THREE.RingGeometry(0.86, 1.0, 40).rotateX(-Math.PI / 2);
    this._discGeo = new THREE.CircleGeometry(1, 36).rotateX(-Math.PI / 2);
    this._shotGeo = new THREE.SphereGeometry(1, 12, 8);
    this._shotMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 2.2, 1.9), toneMapped: false });
  }

  get collision() { return this.game.collision; }
  get nav() { return this.game.nav; }

  /** Carrega o modelo (ShadowMinion.glb) uma vez. */
  async load() {
    const list = await Promise.all(VARIANTS.map((v) => loadSombritoAsset(this.game.assets, modelOf(v))));
    VARIANTS.forEach((v, i) => { this.assets[v] = list[i]; });
    this.asset = this.assets.base;
    if (this._pending) { const n = this._pending; this._pending = null; this.spawnFromNodes(n); }
    return this;
  }

  // ----- ciclo de vida -----------------------------------------------------------------------------
  /**
   * @param {{id:string, x:number, z:number, yaw?:number, territory?:number}[]} nodes
   */
  spawnFromNodes(nodes) {
    this._clearList();
    if (!this.asset) { this._pending = nodes; return; }
    for (const n of nodes) {
      const e = new Enemy(this, this.assets[n.variant] ?? this.asset, n);
      this.game.scene.add(e.root);
      this.list.push(e);
    }
  }

  /** Cria um Sombrito avulso (invocado pelo Druida): nasce com o clip Spawn e já parte para cima dela. */
  addSummoned(x, z, yaw = 0, variant = 'base') {
    if (!this.asset) return null;
    const e = new Enemy(this, this.assets[variant] ?? this.asset, { id: `Summoned_${this.list.length}`, x, z, yaw, territory: 9, variant });
    e.summoned = true;
    this.game.scene.add(e.root);
    this.list.push(e);
    e.brain.set(ST.SPAWN);
    return e;
  }

  /** Sombritos invocados vivos. */
  summonedAlive() { return this.list.filter((e) => e.summoned && e.brain.state !== ST.DEAD && e.brain.state !== ST.DIE).length; }

  /** Derrete os Sombritos invocados (fim da luta). */
  killSummoned() {
    for (const e of this.list) if (e.summoned && e.brain.state !== ST.DEAD && e.brain.state !== ST.DIE) { e.health.damage(99); e.brain.set(ST.DIE); }
  }

  /** Remove só os Sombritos (os alvos extras ficam). */
  _clearList() {
    for (const e of this.list) e.dispose();
    this.list = [];
    this._threats = [];
    this.fx.clear();
  }

  /** Remove todos (troca de cenário). */
  clear() {
    for (const it of [...this.shots, ...this.marks]) it.obj.parent?.remove(it.obj);
    this.shots = [];
    this.marks = [];
    for (const e of this.list) e.dispose();
    this.list = [];
    this.extras = [];
    this._threats = [];
    this.fx.clear();
  }

  update(dt) {
    for (const e of this.list) e.update(dt);
    this._shieldPush(dt);
    this._updateShots(dt);
    this._updateMarks(dt);
    if (this.list.some((e) => e.summoned && e.brain.state === ST.DEAD)) {
      for (const e of this.list) if (e.summoned && e.brain.state === ST.DEAD) e.dispose();
      this.list = this.list.filter((e) => !(e.summoned && e.brain.state === ST.DEAD));
    }
    this.fx.update(dt);
  }

  /** Tudo que os raios / o Broto podem acertar: Sombritos + alvos extras (que aceitam a fonte do golpe). */
  * targets(src = 'bolt') {
    for (const e of this.list) yield e;
    for (const x of this.extras) if (x.accepts ? x.accepts(src) : true) yield x;
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

  /**
   * What this enemy goes for: her, or a Broto Guardião (a decoy) if one is visible and not much farther than her.
   * @returns {{x:number, z:number, kind:'player'|'sprout', ref:object|null}|null}
   */
  targetFor(enemy) {
    const pl = this.target();
    const decoys = this.game.sprout?.decoys?.() ?? [];
    let best = null, bd = Infinity;
    for (const s of decoys) {
      const d = Math.hypot(s.x - enemy.pos.x, s.z - enemy.pos.z);
      if (d < bd) { bd = d; best = s; }
    }
    if (best && bd <= enemy.C.notice + 1) {
      const dp = pl ? Math.hypot(pl.x - enemy.pos.x, pl.z - enemy.pos.z) : Infinity;
      if (bd < dp + DECOY_BIAS) return { x: best.x, z: best.z, kind: 'sprout', ref: best.ref };
    }
    return pl ? { x: pl.x, z: pl.z, kind: 'player', ref: null } : null;
  }

  /** Damage whatever `t` (from targetFor) is. */
  hurtTarget(t, dmg, fromX, fromZ) {
    if (!t) return;
    if (t.kind === 'sprout') this.game.sprout?.hurt(t.ref, dmg);
    else this.vitals?.hit(dmg, fromX, fromZ);
  }

  // ---------------------------------------------------------------------------------------------
  // Sombrão: ground slam (telegraph ring, then damage + shockwave)
  // ---------------------------------------------------------------------------------------------
  telegraph(x, z, radius, time) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.55, 0.3), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const fillMat = mat.clone();
    fillMat.opacity = 0.22;
    const g = new THREE.Group();
    const ring = new THREE.Mesh(this._ringGeo, mat);
    const fill = new THREE.Mesh(this._discGeo, fillMat);
    ring.scale.set(radius, 1, radius);
    fill.scale.set(0.01, 1, 0.01);
    g.add(ring, fill);
    g.position.set(x, 0.04, z);
    this.game.scene.add(g);
    this.marks.push({ obj: g, fill, radius, t: 0, time: Math.max(0.2, time) });
  }

  _updateMarks(dt) {
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      m.t += dt;
      const k = Math.min(1, m.t / m.time);
      m.fill.scale.set(m.radius * k, 1, m.radius * k);
      if (m.t >= m.time + 0.15) { m.obj.parent?.remove(m.obj); this.marks.splice(i, 1); }
    }
  }

  slam(x, z, radius, dmg, from) {
    const g = this.game;
    const p = g.player;
    if (p && !p.defeated && Math.hypot(p.pos.x - x, p.pos.z - z) <= radius + 0.15) this.vitals?.hit(dmg, from.pos.x, from.pos.z);
    for (const d of g.sprout?.decoys?.() ?? []) if (Math.hypot(d.x - x, d.z - z) <= radius) g.sprout.hurt(d.ref, dmg);
    g.sparkles?.burst(x, 0.08, z, 26, { speed: 2.6, life: 0.55, size: 0.08, gravity: -5, palette: [[0.6, 0.45, 0.35], [0.8, 0.6, 0.45], [2.2, 0.7, 0.35]] });
    this.fx.poof(x, 0.1, z, { scale: 1.2, count: 6, sparks: 10 });
  }

  // ---------------------------------------------------------------------------------------------
  // Cuspidor: straight spit ball (dodge through it or block it with the shield)
  // ---------------------------------------------------------------------------------------------
  spit(from, tgt) {
    const yaw = Math.atan2(tgt.x - from.pos.x, tgt.z - from.pos.z);
    const mesh = new THREE.Mesh(this._shotGeo, this._shotMat);
    mesh.scale.setScalar(0.07);
    mesh.position.set(from.pos.x + Math.sin(yaw) * 0.25, SPIT.y, from.pos.z + Math.cos(yaw) * 0.25);
    this.game.scene.add(mesh);
    this.shots.push({ obj: mesh, vx: Math.sin(yaw) * SPIT.speed, vz: Math.cos(yaw) * SPIT.speed, t: 0, trail: 0 });
  }

  _updateShots(dt) {
    const g = this.game, p = g.player;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      const pos = s.obj.position;
      s.t += dt;
      pos.x += s.vx * dt;
      pos.z += s.vz * dt;
      s.trail -= dt;
      if (s.trail <= 0) {
        s.trail = 0.03;
        g.sparkles?.emit?.({ x: pos.x, y: pos.y, z: pos.z, vx: rand(-0.2, 0.2), vy: rand(0, 0.25), vz: rand(-0.2, 0.2), life: 0.35, size: 0.05, r: 0.4, g: 2.0, b: 1.8, gravity: -0.3, drag: 2 });
      }
      let pop = s.t > SPIT.life || g.collision.pointBlocked?.(pos.x, pos.y, pos.z, 0.04);
      if (!pop && p && !p.defeated && Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < SPIT.radius + 0.2) {
        this.vitals?.hit(SPIT.damage, pos.x - s.vx * 0.05, pos.z - s.vz * 0.05);
        pop = true;
      }
      if (!pop) {
        for (const d of g.sprout?.decoys?.() ?? []) {
          if (Math.hypot(d.x - pos.x, d.z - pos.z) < SPIT.radius + 0.2) { g.sprout.hurt(d.ref, SPIT.damage); pop = true; break; }
        }
      }
      if (pop) {
        g.sparkles?.burst(pos.x, pos.y, pos.z, 12, { speed: 1.6, life: 0.4, size: 0.06, gravity: -2, palette: [[0.4, 2.1, 1.8], [0.8, 2.4, 2.2]] });
        s.obj.parent?.remove(s.obj);
        this.shots.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Magic shield: enemies can't walk through the bubble in front of her
  // ---------------------------------------------------------------------------------------------
  _shieldPush() {
    const p = this.game.player;
    if (!p?.blocking || p.defeated) return;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const col = this.game.collision;
    for (const e of this.list) {
      if (!e.brain.targetable) continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      const reach = SHIELD_PUSH.reach + e.radius;
      if (d >= reach || d < 1e-4) continue;
      if ((dx * fx + dz * fz) / d < SHIELD_PUSH.cone) continue;      // only the front of the bubble
      const nx = dx / d, nz = dz / d, pen = reach - d;
      col.move(e.pos, nx * pen, nz * pen, e.radius, e.height);
      const vin = (e.kvx ?? 0) * nx + (e.kvz ?? 0) * nz;             // cancel any push into the bubble
      if (vin < SHIELD_PUSH.bounce) { e.kvx = (e.kvx ?? 0) + nx * (SHIELD_PUSH.bounce - vin); e.kvz = (e.kvz ?? 0) + nz * (SHIELD_PUSH.bounce - vin); }
    }
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
  damageAt(pos, radius, dmg, fromPos = null, src = 'bolt') {
    let best = null, bd = Infinity;
    for (const e of this.targets(src)) {
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
  nearest(pos, maxDist = Infinity, src = 'bolt') {
    let best = null, bd = maxDist;
    for (const e of this.targets(src)) {
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
