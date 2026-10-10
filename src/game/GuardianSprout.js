import * as THREE from 'three';
import { GOLD_PALETTE } from './CombatFx.js';
import { clamp, damp, dampAngle, easeOutBack, smoothstep, yawOf } from './util.js';

// =============================================================================================
// v0.3: Broto Guardião (tecla Q, depois do mini game da horta: flags.sproutSpell).
// A Aprendiz toca Attack_Basic; no evento `release` nasce um broto carnívoro de morango (GuardianSprout.glb) a ~2 m
// à frente (ou perto do inimigo mais próximo, até 6 m). Ele cresce do chão, balança, a cada ~1,2 s morde (ou cospe
// sementes, se estiver longe) o inimigo mais próximo e depois de 10 s murcha. Até 2 ao mesmo tempo; recarga de 8 s.
// Os nós do modelo (Root > Leaves, Stem > Head > JawTop(Crown)/JawBottom) são animados na mão.
// =============================================================================================

// ---- ajustes ----------------------------------------------------------------------------------
export const SPROUT = {
  cooldown: 8,
  lifetime: 10,
  max: 2,
  ahead: 2.0,             // m à frente da Aprendiz (sem inimigo por perto)
  seek: 6,                // m: procura inimigo a partir da Aprendiz
  enemyGap: 1.3,          // m: nasce a esta distância do inimigo, do lado da Aprendiz
  maxCast: 4.5,           // m: o broto nunca nasce mais longe que isso dela
  hp: 4,                  // golpes que ele aguenta (os inimigos agora atacam o broto)
  biteRange: 2.5,         // m: alvo = inimigo mais próximo até aqui
  closeRange: 1.3,        // m: até aqui ele morde de perto (bote); mais longe cospe sementes
  biteEvery: 1.2,
  biteDamage: 1,
  growTime: 0.75,
  witherTime: 0.9,
  hop: 0.55,              // m: quanto o broto avança no bote
  seedSpeed: 9,
};

// ---- textos -------------------------------------------------------------------------------------
const TOAST_COOLDOWN = 'Broto Guardião recarregando...';
const TOAST_MAX = 'Já tem dois guardiões em campo!';
const HINT_INDOORS = 'Aqui dentro não dá: o chão é de madeira. Só ao ar livre!';

const DIRT = [[0.55, 0.38, 0.25], [0.72, 0.52, 0.34], [0.44, 0.3, 0.2]];
const SEED = [[2.4, 2.0, 0.8], [2.0, 1.9, 0.6]];
const LEAF = [[0.7, 2.0, 0.8], [1.0, 2.2, 0.9]];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

/** Broto de emergência (se o GuardianSprout.glb não existir): mesmos nomes de nós. */
function placeholderSprout() {
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
  const scene = new THREE.Group();
  const root = new THREE.Group(); root.name = 'Root';
  const leaves = new THREE.Group(); leaves.name = 'Leaves';
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.1, 0.05, 8), mat(0x4fb06d)); ring.position.y = 0.03;
  leaves.add(ring);
  const stem = new THREE.Group(); stem.name = 'Stem';
  stem.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.2, 8), mat(0x3fa34d)).translateY(0.1));
  const head = new THREE.Group(); head.name = 'Head'; head.position.set(0, 0.2, 0);
  const top = new THREE.Group(); top.name = 'JawTop'; top.position.set(0, 0.1, 0);
  top.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xe8384f)));
  const low = new THREE.Group(); low.name = 'JawBottom'; low.position.set(0, 0.1, 0);
  low.add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat(0xc42544)));
  head.add(top, low); stem.add(head); root.add(leaves, stem); scene.add(root);
  return { scene, clips: new Map(), placeholder: true };
}

export class GuardianSprout {
  /** @param {import('./Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.list = [];
    this.cd = 0;
    this._msgAt = 0;
    const a = game.assets?.models?.sprout;
    this.asset = a && !a.placeholder && a.scene ? a : placeholderSprout();
  }

  get active() { return this.list.filter((s) => !s.dead); }

  // --------------------------------------------------------------------------------------------
  update(dt) {
    const g = this.game;
    dt = Math.min(dt, 0.05);
    this.cd = Math.max(0, this.cd - dt);
    if (g.scenes.current === 'house') {            // entrou em casa: os brotos ficam para trás
      if (this.list.length) this.clear();
    } else if (g.input.enabled && g.input.wasPressed('KeyQ')) this._press();
    if (g.scenes.current === 'house' && g.state.flags.sproutSpell && g.input.enabled && g.input.wasPressed('KeyQ')) this._say(HINT_INDOORS, 'hint');
    for (const s of this.list) this._tick(s, dt);
    if (this.list.some((s) => s.dead)) this.list = this.list.filter((s) => !s.dead);
  }

  /** Sprouts enemies can see and attack (a decoy: they go for it if it's closer than her). */
  decoys() {
    const out = [];
    for (const s of this.list) {
      if (s.dead || s.state === 'wither' || s.state === 'grow') continue;
      out.push({ x: s.root.position.x, z: s.root.position.z, ref: s });
    }
    return out;
  }

  /** An enemy hit the sprout: shake, leaf burst, wither when out of hp. */
  hurt(s, n = 1) {
    if (!s || s.dead || s.state === 'wither') return;
    s.hp -= n;
    s.hurtT = 0.25;
    const p = s.root.position;
    this.game.sparkles.burst(p.x, 0.3, p.z, 12, { speed: 1.4, life: 0.5, size: 0.065, gravity: -4, palette: LEAF });
    if (s.hp <= 0) { s.state = 'wither'; s.wither = 0; s.bite = null; }
  }

  clear() {
    for (const s of this.list) s.root.parent?.remove(s.root);
    this.list = [];
  }

  _say(text, kind = 'toast', ms = 1400) {
    const now = performance.now();
    if (now - this._msgAt < 900) return;
    this._msgAt = now;
    if (kind === 'toast') this.game.ui.toast?.(text, ms);
    else this.game.ui.showHint?.(text, 2600);
  }

  // --------------------------------------------------------------------------------------------
  // Lançar (Q)
  // --------------------------------------------------------------------------------------------
  _press() {
    const g = this.game, p = g.player;
    if (!g.state.flags.sproutSpell) return;
    if (p.locked || p.busy || p.script || p.defeated || g.transitioning) return;
    if (this.cd > 0) { this._say(TOAST_COOLDOWN); return; }
    if (this.active.length >= SPROUT.max) { this._say(TOAST_MAX); return; }
    this.cd = SPROUT.cooldown;
    const spot = this.pickSpot();
    p.playAction('Attack_Basic', {
      cancelAfter: 'release', fade: 0.12, faceYaw: spot.faceYaw,
      events: { release: () => this.spawn(spot.x, spot.z, spot.yaw) },
    });
  }

  /** Onde nasce o broto: perto do inimigo mais próximo (até `seek`) ou a `ahead` metros à frente. */
  pickSpot() {
    const g = this.game, p = g.player;
    const e = g.enemies.nearest(p.pos, SPROUT.seek, 'sprout');
    let x, z, yaw, faceYaw;
    if (e) {
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const t = clamp(d - SPROUT.enemyGap, 0.8, SPROUT.maxCast);
      x = p.pos.x + (dx / d) * t; z = p.pos.z + (dz / d) * t;
      yaw = yawOf(e.pos.x - x, e.pos.z - z);
      faceYaw = yawOf(dx, dz);
    } else {
      p.forward(_a);
      x = p.pos.x + _a.x * SPROUT.ahead; z = p.pos.z + _a.z * SPROUT.ahead;
      yaw = p.yaw;
      faceYaw = null;
    }
    // não nasce dentro de parede/cerca/árvore: recua em direção à Aprendiz
    const bx = p.pos.x - x, bz = p.pos.z - z;
    const bl = Math.hypot(bx, bz) || 1;
    for (let i = 0; i < 8 && g.collision.pointBlocked(x, 0.2, z, 0.3); i++) { x += (bx / bl) * 0.3; z += (bz / bl) * 0.3; }
    if (g.collision.pointBlocked(x, 0.2, z, 0.3)) { p.forward(_a); x = p.pos.x + _a.x * 0.8; z = p.pos.z + _a.z * 0.8; }
    return { x, z, yaw, faceYaw };
  }

  spawn(x, z, yaw = 0) {
    const g = this.game;
    if (this.active.length >= SPROUT.max) return null;
    const root = this.asset.scene.clone(true);
    root.position.set(x, 0, z);
    root.rotation.y = yaw;
    const k = 0.95 + Math.random() * 0.15;
    root.scale.setScalar(k);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = false; } });
    const n = (name) => root.getObjectByName(name);
    const s = {
      root, k, yaw, t: 0, life: SPROUT.lifetime, state: 'grow', dead: false, phase: Math.random() * 6.28,
      nextBite: 0.9 + Math.random() * 0.3, bite: null, target: null, wither: 0, hp: SPROUT.hp, hurtT: 0,
      leaves: n('Leaves'), stem: n('Stem'), head: n('Head'), jawT: n('JawTop'), jawB: n('JawBottom'), crown: n('Crown'),
      pending: [], dirtDone: false,
    };
    g.scene.add(root);
    this.list.push(s);
    g.sparkles.burst(x, 0.06, z, 24, { speed: 1.5, life: 0.75, size: 0.075, gravity: -7, palette: DIRT });
    this._pose(s, 0);
    return s;
  }

  // --------------------------------------------------------------------------------------------
  // Animação
  // --------------------------------------------------------------------------------------------
  _tick(s, dt) {
    const g = this.game;
    s.t += dt;
    const pos = s.root.position;

    if (s.state === 'grow') {
      const kk = clamp(s.t / SPROUT.growTime, 0, 1);
      this._pose(s, kk);
      if (kk > 0.45 && !s.dirtDone) {
        s.dirtDone = true;
        g.sparkles.burst(pos.x, 0.08, pos.z, 14, { speed: 1.1, life: 0.6, size: 0.06, gravity: -6, palette: DIRT });
        g.sparkles.burst(pos.x, 0.25, pos.z, 8, { speed: 0.9, life: 0.9, size: 0.06, gravity: -0.3, palette: LEAF });
      }
      if (kk >= 1) { s.state = 'idle'; s.t = 0; }
      return;
    }

    if (s.state === 'wither') {
      s.wither += dt;
      const w = clamp(s.wither / SPROUT.witherTime, 0, 1);
      const e = smoothstep(w);
      if (s.stem) { s.stem.rotation.set(0.15 * e, 0, 0); s.stem.scale.set(1, 1 - 0.45 * e, 1); }
      if (s.head) s.head.rotation.set(1.15 * e, 0, Math.sin(w * 9) * 0.05 * (1 - w));
      if (s.jawT) s.jawT.rotation.x = 0.08 * e;
      if (s.jawB) s.jawB.rotation.x = 0;
      if (s.leaves) s.leaves.scale.setScalar(Math.max(0.001, 1 - 0.5 * e));
      s.root.scale.setScalar(s.k * Math.max(0.001, 1 - smoothstep((w - 0.55) / 0.45)));
      if (w >= 1) {
        g.sparkles.burst(pos.x, 0.1, pos.z, 16, { speed: 1.0, life: 0.6, size: 0.06, gravity: -6, palette: DIRT });
        s.root.parent?.remove(s.root);
        s.dead = true;
      }
      return;
    }

    // ---- idle / bite
    if (s.hurtT > 0) {                       // got hit: a quick squash wobble
      s.hurtT -= dt;
      const w = Math.max(0, s.hurtT) / 0.25;
      s.root.scale.set(s.k * (1 + 0.15 * w), s.k * (1 - 0.18 * w), s.k * (1 + 0.15 * w));
      if (s.hurtT <= 0) s.root.scale.setScalar(s.k);
    }
    s.life -= dt;
    if (s.life <= 0) { s.state = 'wither'; s.wither = 0; s.bite = null; return; }

    // alvo: inimigo mais próximo ao alcance
    s.target = g.enemies.nearest(pos, SPROUT.biteRange, 'sprout');
    const near = g.enemies.nearest(pos, 5, 'sprout');
    const lookYaw = near ? yawOf(near.pos.x - pos.x, near.pos.z - pos.z) : s.yaw;
    s.root.rotation.y = dampAngle(s.root.rotation.y, lookYaw, 8, dt);

    s.nextBite -= dt;
    if (!s.bite && s.target && s.nextBite <= 0) this._startBite(s);

    for (let i = s.pending.length - 1; i >= 0; i--) {
      const q = s.pending[i];
      q.t -= dt;
      if (q.t <= 0) { s.pending.splice(i, 1); q.fn(); }
    }

    if (s.bite) this._biteAnim(s, dt);
    else this._idleAnim(s, dt);
  }

  /** Posição do chão ao nascer: a haste sobe de baixo da terra e as folhas abrem. */
  _pose(s, k) {
    const e = easeOutBack(k, 1.7);
    if (s.stem) { s.stem.position.y = -0.34 * (1 - e); s.stem.rotation.set(0, 0, 0); s.stem.scale.set(1, 1, 1); }
    if (s.head) s.head.rotation.set(0, 0, 0);
    if (s.leaves) s.leaves.scale.setScalar(Math.max(0.001, smoothstep(k * 1.5)));
    if (s.jawT) s.jawT.rotation.x = -0.45 * (1 - smoothstep(k)) * Math.sin(k * 14) * 0.6;
    if (s.jawB) s.jawB.rotation.x = 0.3 * (1 - smoothstep(k)) * Math.sin(k * 14) * 0.6;
    s.root.scale.setScalar(s.k * (0.3 + 0.7 * smoothstep(k * 2)));
  }

  _idleAnim(s, dt) {
    const t = s.t + s.phase;
    s.stem.position.y = damp(s.stem.position.y, 0, 12, dt);
    s.stem.scale.set(1, 1, 1);
    s.stem.rotation.set(Math.sin(t * 1.7) * 0.05, 0, Math.sin(t * 2.1) * 0.08);
    s.head.rotation.set(Math.sin(t * 2.6 + 1) * 0.05, 0, Math.sin(t * 3.1) * 0.06);
    const open = 0.1 + 0.08 * Math.sin(t * 5.4);                     // a boquinha mexe, ansiosa
    s.jawT.rotation.x = -open;
    s.jawB.rotation.x = open * 0.7;
    if (s.crown) s.crown.rotation.z = Math.sin(t * 4.2) * 0.07;
    if (s.leaves) s.leaves.scale.setScalar(1 + Math.sin(t * 2.4) * 0.02);
    s.root.scale.setScalar(s.k);
  }

  _startBite(s) {
    const e = s.target;
    const pos = s.root.position;
    const dx = e.pos.x - pos.x, dz = e.pos.z - pos.z;
    const d = Math.hypot(dx, dz);
    s.nextBite = SPROUT.biteEvery * (0.9 + Math.random() * 0.25);
    s.bite = { t: 0, e, dx: dx / (d || 1), dz: dz / (d || 1), d, spit: d > SPROUT.closeRange, hit: false, base: { x: pos.x, z: pos.z } };
    s.root.rotation.y = yawOf(dx, dz);
  }

  _biteAnim(s, dt) {
    const g = this.game, b = s.bite;
    b.t += dt;
    const t = b.t;
    const W = 0.16, L = 0.14, R = 0.3;                  // anticipação, bote, recuperação (s)
    let lean, jawOpen, hop = 0;
    if (t < W) {                                          // puxa para trás e escancara
      const k = smoothstep(t / W);
      lean = -0.38 * k; jawOpen = 0.85 * k;
    } else if (t < W + L) {                               // bote
      const k = smoothstep((t - W) / L);
      lean = -0.38 + 1.0 * k; jawOpen = 0.85; hop = k;
      if (!b.hit && k > 0.7) this._biteHit(s, b);
    } else {                                              // fecha de estalo e volta
      const k = clamp((t - W - L) / R, 0, 1);
      const snap = clamp((t - W - L) / 0.07, 0, 1);
      lean = 0.62 * (1 - smoothstep(k));
      jawOpen = 0.85 * (1 - snap) - 0.06 * Math.sin(k * Math.PI);
      hop = 1 - smoothstep(k * 1.4);
      if (!b.hit) this._biteHit(s, b);
      if (k >= 1) { s.bite = null; }
    }
    if (!s.bite) { s.root.position.x = b.base.x; s.root.position.z = b.base.z; return; }
    const reach = b.spit ? 0.18 : Math.min(SPROUT.hop, Math.max(0.15, b.d - 0.45));
    s.root.position.x = b.base.x + b.dx * reach * hop;
    s.root.position.z = b.base.z + b.dz * reach * hop;
    s.stem.rotation.set(lean, 0, 0);
    s.stem.scale.set(1, 1 + 0.2 * Math.max(0, hop), 1);
    s.head.rotation.set(lean * 0.45, 0, 0);
    s.jawT.rotation.x = -jawOpen;
    s.jawB.rotation.x = jawOpen * 0.6;
    if (s.crown) s.crown.rotation.z = Math.sin(t * 30) * 0.08;
  }

  _biteHit(s, b) {
    const g = this.game;
    b.hit = true;
    const e = b.e;
    s.head.getWorldPosition(_a);
    if (b.spit) {
      // cospe sementes: um fio de faíscas amarelas até o inimigo, e o dano chega junto
      _b.set(e.pos.x - _a.x, (e.pos.y + 0.22) - _a.y, e.pos.z - _a.z);
      const dist = _b.length() || 1;
      _b.divideScalar(dist);
      for (let i = 0; i < 9; i++) {
        const c = SEED[i % SEED.length];
        g.sparkles.emit({
          x: _a.x, y: _a.y, z: _a.z, vx: _b.x * SPROUT.seedSpeed + (Math.random() - 0.5) * 0.4, vy: _b.y * SPROUT.seedSpeed + (Math.random() - 0.5) * 0.4,
          vz: _b.z * SPROUT.seedSpeed + (Math.random() - 0.5) * 0.4, life: dist / SPROUT.seedSpeed, size: 0.05, r: c[0], g: c[1], b: c[2], gravity: 0, drag: 0.1,
        });
      }
      s.pending.push({ t: dist / SPROUT.seedSpeed, fn: () => this._damage(s, e) });
    } else {
      this._damage(s, e);
    }
    g.sparkles.burst(_a.x, _a.y, _a.z, 8, { speed: 1.0, life: 0.5, size: 0.055, gravity: -2, palette: GOLD_PALETTE });
  }

  _damage(s, e) {
    const g = this.game;
    if (!e.targetable) return;
    g.enemies.damageAt({ x: e.pos.x, y: e.pos.y + 0.2, z: e.pos.z }, 0.25, SPROUT.biteDamage, s.root.position, 'sprout');
    if (Math.random() < 0.35) g.texts.spawn('Nhac!', e.pos.x, e.pos.y + 0.7, e.pos.z, { scale: 0.5 });
  }
}
