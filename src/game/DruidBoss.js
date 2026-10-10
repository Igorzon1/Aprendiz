import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { Animator } from './Animator.js';
import { BossAttacks } from './BossAttacks.js';
import { PURPLE_PALETTE } from './CombatFx.js';
import {
  BOSS, BOSS_NAME, INTRO_LINES, LINE_PHASE2, LINE_PHASE3, LINES_TAUNT, OBJ_BOSS, OUTRO_AFTER_BLOOM, OUTRO_LINES,
  TOAST_PATH_FREE, TOAST_REWARD,
} from './configForest.js';
import { SHADOW_COLORS } from './Fx.js';
import { Emitter, clamp, dampAngle, pick, rand, wait, weightedPick, yawOf } from './util.js';

// =================================================================================================
// O Druida Sombrio (ShadowDruid.glb): o chefe da Floresta Sombria.
// Estados: dormant (sentado no cogumelo) -> intro (cutscene) -> fight -> dying (cutscene) -> friendly.
// Dentro da luta ("mode"): gap (pausa) -> cast (ataque avisado) -> tp (some e reaparece) -> gap ...
// Interface "tipo inimigo" (targetable / pos / radius / damage / centerWorld / accepts) para os raios e o Broto Guardião.
// =================================================================================================

function flashHook(shader) {
  shader.uniforms.uFlash = this.userData.flash;
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'uniform float uFlash;\nvoid main() {')
    .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.9, 1.7, 2.2), uFlash);');
}

const _v = new THREE.Vector3();

export class DruidBoss extends Emitter {
  /**
   * @param {import('./Game.js').Game} game
   * @param {import('./ForestScene.js').ForestScene} forest
   */
  constructor(game, forest) {
    super();
    this.game = game;
    this.forest = forest;
    const asset = game.assets.models.druid;
    this.root = new THREE.Group();
    this.root.name = 'DruidBoss';
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.model = cloneSkinned(asset.scene);
    this.model.scale.multiplyScalar(BOSS.scale);
    this.body.add(this.model);
    this.mats = [];
    this.model.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      o.castShadow = true;
      o.receiveShadow = false;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      const cloned = list.map((m) => {
        if (!m) return m;
        const c = m.clone();
        c.userData.flash = { value: 0 };
        c.onBeforeCompile = flashHook;
        c.customProgramCacheKey = () => 'druid-flash';
        c.needsUpdate = true;
        this.mats.push(c);
        return c;
      });
      o.material = Array.isArray(o.material) ? cloned : cloned[0];
    });
    this.animator = new Animator(this.model, asset.clips, asset.events, { fps: asset.fps });
    this.animator.on('finished', (clip) => this._onFinished(clip));
    this.head = this.model.getObjectByName('head') ?? null;
    this.orbBone = this.model.getObjectByName('fx_dark') ?? null;
    this.animator.play('Idle', { fade: 0 });
    this.animator.update(0.001);

    this.pos = this.root.position;
    this.yaw = 0;
    this.radius = BOSS.radius;
    this.attacks = new BossAttacks(game);
    this.attacks.onResult = (k) => this._onResult(k);

    this.state = 'dormant';
    this.mode = null;
    this.hp = BOSS.hp;
    this.max = BOSS.hp;
    this.phase = 1;
    this.t = 0;
    this.flash = 0;
    this.hitCd = 0;
    this.vis = 1;            // 0..1 (some / reaparece)
    this.ghost = false;
    this.once = null;
    this.gapT = 1;
    this.seq = null;
    this.tp = null;
    this.summonCd = 4;
    this.last = [];
    this.pendingPhase = 0;
    this.pendingTaunt = false;
    this.forceNext = null;
    this.seat = { x: 0, y: 1.9, z: 0, yaw: 0 };
    this.root.visible = false;
    game.scene.add(this.root);
  }

  // ---- interface "tipo inimigo" -------------------------------------------------------------------
  get targetable() { return this.state === 'fight' && !this.ghost && this.vis > 0.6; }
  accepts() { return true; }
  centerWorld(out = new THREE.Vector3()) { return out.set(this.pos.x, 0.55, this.pos.z); }
  headWorld(out = new THREE.Vector3()) {
    if (this.head) return this.head.getWorldPosition(out);
    return out.set(this.pos.x, this.pos.y + 1.0, this.pos.z);
  }

  /** Dano (raio / mordida). Retorna true se valeu. */
  damage(n, fromX = null, fromZ = null) {
    if (!this.targetable) return false;
    this.hp = Math.max(0, this.hp - n);
    this.flash = 1;
    const c = this.centerWorld(_v);
    this.game.enemies.fx.hitSpark(c.x, c.y, c.z, 14);
    this.game.ui.showBossBar?.(BOSS_NAME, this.hp, this.max);
    if (this.hp <= 0) { this._defeat(); return true; }
    if (this.mode === 'gap' && this.hitCd <= 0 && !this.once) {
      this.hitCd = BOSS.hitCooldown;
      this._play('Hit', { fade: 0.05 });
    }
    const f = this.hp / this.max;
    if (this.phase === 1 && f < BOSS.phase2) this.pendingPhase = 2;
    else if (this.phase <= 2 && f < BOSS.phase3) this.pendingPhase = 3;
    return true;
  }

  // ---- posicionamento ---------------------------------------------------------------------------------
  setSeat(x, y, z, yaw) { this.seat = { x, y, z, yaw }; }

  /** Coloca o chefe no cogumelo, dormindo (e zera tudo). */
  mount() {
    this.attacks.clear();
    this.state = 'dormant';
    this.mode = null;
    this.seq = null;
    this.tp = null;
    this.once = null;
    this.hp = this.max;
    this.phase = 1;
    this.vis = 1;
    this.ghost = false;
    this.pendingPhase = 0;
    this.pendingTaunt = false;
    this.forceNext = null;
    this.summonCd = 4;
    this.last = [];
    this.body.scale.setScalar(1);
    this.pos.set(this.seat.x, this.seat.y, this.seat.z);
    this.yaw = this.seat.yaw;
    this.root.rotation.y = this.yaw;
    this.animator.play('Idle', { fade: 0 });
  }

  /** Depois da luta: em pé e amigo, perto do centro da clareira. */
  makeFriendly(x, z) {
    this.state = 'friendly';
    this.mode = null;
    this.once = null;
    this.vis = 1;
    this.ghost = false;
    this.body.scale.setScalar(1);
    this.pos.set(x, 0, z);
    this.animator.play('Idle', { fade: 0.3 });
  }

  setVisible(v) { this.root.visible = v; }

  // ---- animação --------------------------------------------------------------------------------------------
  _play(name, { ts = 1, fade = 0.12, hold = false, cb = null } = {}) {
    this.once = { name, hold, cb };
    this.animator.play(name, { fade, timeScale: ts, fallback: ['Idle'] });
  }

  _onFinished(clip) {
    const o = this.once;
    if (!o || o.name !== clip) return;
    this.once = null;
    if (!o.hold) this.animator.play('Idle', { fade: 0.18 });
    o.cb?.();
  }

  // ---- resultado dos golpes nela (para o "sarcasmo") ------------------------------------------------------
  _onResult(kind) {
    if ((kind === 'dodged' || kind === 'blocked') && Math.random() < BOSS.tauntChance) this.pendingTaunt = true;
  }

  // =============================================================================================
  // Atualização
  // =============================================================================================
  update(dt) {
    if (!this.root.visible) return;
    dt = Math.min(dt, 0.05);
    this.t += dt;
    this.hitCd = Math.max(0, this.hitCd - dt);
    this.summonCd = Math.max(0, this.summonCd - dt);
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 6);
      for (const m of this.mats) m.userData.flash.value = this.flash;
    }
    const p = this.game.player;
    const toP = yawOf(p.pos.x - this.pos.x, p.pos.z - this.pos.z);

    if (this.state === 'fight') this._fight(dt, toP);
    else if (this.state === 'friendly') {
      const near = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < 6;
      if (near) this.yaw = dampAngle(this.yaw, toP, 4, dt);
    } else if (this.state === 'dormant' || this.state === 'intro') {
      if (Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) < 14) this.yaw = dampAngle(this.yaw, toP, 2.2, dt);
    } else if (this.state === 'dying') {
      this.yaw = dampAngle(this.yaw, toP, 2.5, dt);
    }
    this.root.rotation.y = this.yaw;

    // sumir / reaparecer
    const s = clamp(this.vis, 0.001, 1);
    this.body.scale.set(s, 0.2 + 0.8 * s, s);

    this.attacks.update(dt);
    this.animator.update(dt);
  }

  _fight(dt, toP) {
    if (this.mode === 'tp') { this._updateTp(dt); return; }
    this.yaw = dampAngle(this.yaw, toP, this.mode === 'cast' ? 5 : 8, dt);
    if (this.mode === 'gap') {
      this.gapT -= dt;
      if (this.gapT <= 0 && !this.once) this._chooseAttack();
    } else if (this.mode === 'cast' && this.seq) {
      if (this.dashMove) this._updateDash(dt);
      const s = this.seq;
      s.t += dt;
      for (const st of s.steps) if (!st.done && s.t >= st.t) { st.done = true; st.fn(); }
      if (s.t >= s.end) { this.seq = null; this._afterCast(); }
    } else if (this.mode === 'taunt' && this.seq) {
      this.seq.t += dt;
      if (this.seq.t >= this.seq.end) { this.seq = null; this._toGap(0.5); }
    }
  }

  _toGap(extra = 0) {
    this.mode = 'gap';
    const [a, b] = BOSS.gap[this.phase];
    this.gapT = Math.max(0.15, rand(a, b) + extra);
  }

  /** Terminou um ataque: some e reaparece em outro ponto (e, se der, debocha / muda de fase). */
  _afterCast() {
    const next = () => {
      if (this.pendingPhase) { this._phaseShift(); return; }
      if (this.pendingTaunt) { this.pendingTaunt = false; this._taunt(); return; }
      this._toGap(this.chain ? -0.6 : 0);
      this.chain = false;
    };
    const near = Math.hypot(this.game.player.pos.x - this.pos.x, this.game.player.pos.z - this.pos.z) < 2.4;
    if (this.pendingPhase || near || Math.random() < BOSS.tpChance[this.phase]) this._shadowStep(next);
    else { this.mode = 'gap'; next(); }
  }

  // ---- sumir / reaparecer ------------------------------------------------------------------------------------
  _pickSpot() {
    const g = this.game, p = g.player, a = this.forest.arena;
    // prefer the far side of her (away from the camera) so he never ends up under the HUD at the screen bottom
    g.camera.getWorldDirection(_v);
    const away = Math.atan2(_v.x, _v.z);
    for (let i = 0; i < 16; i++) {
      const ang = i < 11 ? away + rand(-1.15, 1.15) : rand(0, Math.PI * 2), d = rand(BOSS.tpDist[0], BOSS.tpDist[1]);
      let x = p.pos.x + Math.sin(ang) * d, z = p.pos.z + Math.cos(ang) * d;
      const dx = x - a.x, dz = z - a.z, r = Math.hypot(dx, dz), lim = a.radius * 0.82;
      if (r > lim) { x = a.x + (dx / r) * lim; z = a.z + (dz / r) * lim; }
      if (Math.hypot(x - p.pos.x, z - p.pos.z) < 2.6) continue;
      if (g.collision.isFree(x, z, 0.5, 1.2)) return { x, z };
    }
    return { x: this.pos.x, z: this.pos.z };
  }

  _shadowStep(done, to = null) {
    this.ghost = true;
    this.mode = 'tp';
    this.seq = null;
    this.tp = { stage: 'out', t: 0, done, to };
    this.game.puffs?.puff(this.pos.x, this.pos.y + 0.3, this.pos.z, { colors: SHADOW_COLORS, count: 7, scale: 1.2, life: 0.55 });
    this.game.sparkles.burst(this.pos.x, this.pos.y + 0.5, this.pos.z, 14, { speed: 1.6, life: 0.6, size: 0.07, gravity: -0.3, palette: PURPLE_PALETTE });
  }

  _updateTp(dt) {
    const tp = this.tp;
    tp.t += dt;
    if (tp.stage === 'out') {
      this.vis = clamp(1 - tp.t / BOSS.tpVanish, 0, 1);
      if (tp.t >= BOSS.tpVanish) {
        const s = tp.to ?? this._pickSpot();
        this.pos.set(s.x, 0, s.z);
        this.once = null;
        this.animator.play('Idle', { fade: 0 });
        this.yaw = yawOf(this.game.player.pos.x - s.x, this.game.player.pos.z - s.z);
        tp.stage = 'in';
        tp.t = 0;
        this.game.puffs?.puff(s.x, 0.3, s.z, { colors: SHADOW_COLORS, count: 7, scale: 1.2, life: 0.55 });
        this.game.sparkles.burst(s.x, 0.5, s.z, 14, { speed: 1.6, life: 0.6, size: 0.07, gravity: -0.3, palette: PURPLE_PALETTE });
      }
    } else {
      this.vis = clamp(tp.t / BOSS.tpAppear, 0, 1);
      if (tp.t >= BOSS.tpAppear) {
        this.vis = 1;
        this.ghost = false;
        this.mode = 'gap';
        const done = tp.done;
        this.tp = null;
        done?.();
      }
    }
  }

  // ---- escolha e execução dos ataques -------------------------------------------------------------------
  _chooseAttack() {
    const ph = this.phase;
    let kind = this.forceNext;
    this.forceNext = null;
    if (!kind) {
      const opts = [['orb', ph === 1 ? 4 : 2], ['lightning', 3], ['thorns', ph === 1 ? 2 : 3], ['dash', ph === 1 ? 2 : 3]];
      if (ph >= 2) opts.push(['roots', 3], ['wave', 3], ['bunny', 2]);
      if (ph >= 3) opts.push(['wave', 1], ['dash', 1]);
      if (ph >= 2 && this.summonCd <= 0 && this.game.enemies.summonedAlive() < BOSS.summon.max) opts.push(['summon', ph === 2 ? 4 : 3]);
      const [a, b] = this.last;
      const filtered = opts.filter(([k]) => !(a === k && b === k));          // nunca 3 iguais seguidos
      kind = weightedPick(filtered.length ? filtered : opts);
    }
    this.last = [this.last[1], kind];
    this.mode = 'cast';
    const spd = BOSS.speed[ph];
    if (kind === 'orb') this._castOrb(spd);
    else if (kind === 'lightning') this._castLightning(spd);
    else if (kind === 'roots') this._castRoots(spd);
    else if (kind === 'thorns') this._castThorns(spd);
    else if (kind === 'dash') this._castDash(spd);
    else if (kind === 'wave') this._castWave(spd);
    else if (kind === 'bunny') this._castBunny(spd);
    else this._castSummon(spd);
  }

  _clipTimes(clip, evt, fallbackEvt, fallbackDur) {
    const a = this.animator;
    return { at: a.eventTime(clip, evt) ?? fallbackEvt, dur: a.has(clip) ? a.duration(clip) : fallbackDur };
  }

  _castOrb(spd) {
    const clip = 'Cast_DarkMagic';
    const { at, dur } = this._clipTimes(clip, 'release', 1.2, 2.0);
    this._play(clip, { ts: spd, fade: 0.08 });
    const steps = [{ t: at / spd, fn: () => this._fireOrb(0) }];
    if (this.phase === 3) steps.push({ t: at / spd + 0.55, fn: () => this._fireOrb(1) });
    this.seq = { t: 0, steps, end: dur / spd * (this.phase === 3 ? 0.95 : 0.9) + (this.phase === 3 ? 0.4 : 0) };
  }

  _fireOrb(i) {
    const p = this.game.player;
    const o = this.orbBone ? this.orbBone.getWorldPosition(_v) : _v.set(this.pos.x, this.pos.y + 0.7, this.pos.z);
    const x = o.x, y = Math.max(0.35, o.y), z = o.z;
    let yaw = yawOf(p.pos.x - x, p.pos.z - z);
    if (i === 1) yaw += (Math.random() < 0.5 ? -1 : 1) * 0.42;
    this.attacks.orb(x, y, z, yaw);
  }

  _castLightning(spd) {
    const L = BOSS.lightning;
    const clip = 'Cast_BlackLightning';
    const { at, dur } = this._clipTimes(clip, 'fire_start', 0.6, 2.0);
    const warn = L.warn / spd;
    const ts = at / warn;
    this._play(clip, { ts, fade: 0.08 });
    const p = this.game.player;
    const aim = () => yawOf(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    const x = this.pos.x, z = this.pos.z;
    if (this.phase === 3) {              // duas linhas com um vão no meio (onde ela estava)
      for (const off of [-0.27, 0.27]) this.attacks.line({ x, z, yaw: aim() + off, track: () => aim() + off, warn, lockBefore: L.lockBefore });
    } else {
      this.attacks.line({ x, z, yaw: aim(), track: aim, warn, lockBefore: L.lockBefore });
    }
    this.seq = { t: 0, steps: [], end: Math.min(dur / ts, warn + L.beam + 0.55) };
  }

  _castRoots(spd) {
    const R = BOSS.roots;
    const clip = 'Cast_ShadowRoots';
    const { at, dur } = this._clipTimes(clip, 'roots_up', 0.6, 2.2);
    const warn = R.warn / spd;
    const ts = at / warn;
    this._play(clip, { ts, fade: 0.08 });
    const p = this.game.player, a = this.forest.arena;
    const n = R.count[this.phase - 1];
    const pts = [{ x: p.pos.x + p.vx * 0.3, z: p.pos.z + p.vz * 0.3 }];
    const a0 = rand(0, Math.PI * 2);
    for (let i = 1; i < n; i++) {
      const ang = a0 + (i * Math.PI * 2) / (n - 1) + rand(-0.4, 0.4), d = rand(1.9, 3.1);
      pts.push({ x: p.pos.x + Math.sin(ang) * d, z: p.pos.z + Math.cos(ang) * d });
    }
    pts.forEach((c, i) => {
      const dx = c.x - a.x, dz = c.z - a.z, r = Math.hypot(dx, dz), lim = a.radius * 0.92;
      if (r > lim) { c.x = a.x + (dx / r) * lim; c.z = a.z + (dz / r) * lim; }
      this.attacks.circle({ x: c.x, z: c.z, radius: R.radius, warn, delay: i * 0.1 });
    });
    this.seq = { t: 0, steps: [], end: Math.min(dur / ts, warn + n * 0.1 + R.hold + 0.1) };
  }

  _castSummon(spd) {
    const S = BOSS.summon;
    const clip = 'Cast_Summon';
    const { at, dur } = this._clipTimes(clip, 'spawn_minion', 0.8, 2.4);
    const warn = S.warn / spd;
    const ts = at / warn;
    this._play(clip, { ts, fade: 0.08 });
    this.summonCd = S.cooldown;
    const g = this.game, p = g.player, a = this.forest.arena;
    const count = Math.max(1, Math.min(S.perCast, S.max - g.enemies.summonedAlive()));
    const base = yawOf(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    for (let i = 0; i < count; i++) {
      let x = this.pos.x, z = this.pos.z, ok = false;
      for (let k = 0; k < 10 && !ok; k++) {
        const ang = base + (i === 0 ? 1 : -1) * rand(1.0, 1.9) + (count === 1 ? rand(-1, 1) : 0), d = S.dist + rand(-0.4, 0.8);
        x = this.pos.x + Math.sin(ang) * d; z = this.pos.z + Math.cos(ang) * d;
        const dx = x - a.x, dz = z - a.z;
        ok = Math.hypot(dx, dz) < a.radius * 0.88 && g.collision.isFree(x, z, 0.3, 0.5);
      }
      const sx = x, sz = z, variant = this._summonVariant(i);
      this.attacks.circle({ x: sx, z: sz, radius: 0.85, warn, kind: 'sigil', onFire: () => { if (this.state === 'fight') g.enemies.addSummoned(sx, sz, yawOf(p.pos.x - sx, p.pos.z - sz), variant); } });
    }
    this.seq = { t: 0, steps: [], end: Math.min(dur / ts, warn * 0.6) };    // no standing around: he keeps attacking
    this.chain = true;
  }

  _summonVariant(i) {
    const pool = BOSS.summon.variants[this.phase] ?? ['base'];
    const brutes = this.game.enemies.list.filter((e) => e.summoned && e.variant === 'brute' && e.brain.targetable).length;
    const ok = pool.filter((v) => v !== 'brute' || (brutes === 0 && i === 0));
    return ok[(Math.random() * ok.length) | 0] ?? 'base';
  }

  _clampArena(c, k = 0.9) {
    const a = this.forest.arena, dx = c.x - a.x, dz = c.z - a.z, r = Math.hypot(dx, dz), lim = a.radius * k;
    if (r > lim) { c.x = a.x + (dx / r) * lim; c.z = a.z + (dz / r) * lim; }
    return c;
  }

  // Chuva de Espinhos: thorns fall on warned spots around (and on) her
  _castThorns(spd) {
    const T = BOSS.thorns;
    const clip = 'Cast_ThornRain';
    const { at, dur } = this._clipTimes(clip, 'rain', 0.55, 1.2);
    const warn = T.warn / spd;
    this._play(clip, { ts: spd, fade: 0.08 });
    const p = this.game.player, n = T.count[this.phase - 1];
    const pts = [{ x: p.pos.x + p.vx * 0.45, z: p.pos.z + p.vz * 0.45 }];
    const a0 = rand(0, Math.PI * 2);
    for (let i = 1; i < n; i++) {
      const ang = a0 + (i * Math.PI * 2) / (n - 1) + rand(-0.3, 0.3), d = rand(1.1, 2.8);
      pts.push({ x: p.pos.x + Math.sin(ang) * d, z: p.pos.z + Math.cos(ang) * d });
    }
    const steps = [{ t: at / spd, fn: () => pts.forEach((c, i) => {
      this._clampArena(c, 0.92);
      this.attacks.circle({ x: c.x, z: c.z, radius: T.radius, warn, kind: 'thorn', delay: i * 0.07 });
    }) }];
    this.seq = { t: 0, steps, end: Math.max(dur / spd * 0.85, at / spd + 0.2) };
    this.chain = this.phase >= 2;
  }

  // Investida Sombria: a warned lane, then he dashes along it (the beam is his shadow trail)
  _castDash(spd) {
    const Dd = BOSS.dash, g = this.game, p = g.player;
    const clip = 'Dash';
    const { at, dur } = this._clipTimes(clip, 'go', 0.17, 0.67);
    const warn = Dd.warn / spd;
    this._play(clip, { ts: at / warn, fade: 0.06 });
    const aim = () => yawOf(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    const len = () => Math.min(Dd.maxLen, Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z) + 2.2);
    const x = this.pos.x, z = this.pos.z, yaw0 = aim(), L = len();
    const lane = this.attacks.line({ x, z, yaw: yaw0, track: aim, warn, lockBefore: Dd.lockBefore, length: L, width: Dd.width, beam: Dd.beam });
    const steps = [{ t: warn, fn: () => {
      const to = this._clampArena({ x: x + Math.sin(lane.yaw) * L, z: z + Math.cos(lane.yaw) * L }, 0.85);
      this.dashMove = { from: { x: this.pos.x, z: this.pos.z }, to, t: 0, dur: Dd.beam };
      this.game.puffs?.puff(this.pos.x, 0.3, this.pos.z, { colors: SHADOW_COLORS, count: 6, scale: 1.1, life: 0.45 });
    } }];
    this.seq = { t: 0, steps, end: warn + Dd.beam + Math.max(0.25, (dur - at) / spd * 0.4) };
  }

  _updateDash(dt) {
    const m = this.dashMove;
    m.t += dt;
    const k = Math.min(1, m.t / m.dur);
    this.pos.x = m.from.x + (m.to.x - m.from.x) * k;
    this.pos.z = m.from.z + (m.to.z - m.from.z) * k;
    if (Math.random() < 0.6) this.game.sparkles.burst(this.pos.x, 0.4, this.pos.z, 2, { speed: 0.6, life: 0.45, size: 0.08, gravity: -0.2, palette: PURPLE_PALETTE });
    if (k >= 1) this.dashMove = null;
  }

  // Onda de Escuridão
  _castWave(spd) {
    const clip = 'Cast_Wave';
    const { at, dur } = this._clipTimes(clip, 'wave', 0.47, 1.0);
    this._play(clip, { ts: spd, fade: 0.08 });
    const steps = [{ t: at / spd, fn: () => this.attacks.wave({ x: this.pos.x, z: this.pos.z }) }];
    if (this.phase === 3) steps.push({ t: at / spd + 0.55, fn: () => this.attacks.wave({ x: this.pos.x, z: this.pos.z }) });
    this.seq = { t: 0, steps, end: dur / spd * 0.9 + (this.phase === 3 ? 0.4 : 0) };
  }

  // Coelho-Bomba
  _castBunny(spd) {
    const clip = 'Cast_BunnyBomb';
    const { at, dur } = this._clipTimes(clip, 'throw', 0.47, 1.33);
    this._play(clip, { ts: spd, fade: 0.08 });
    const steps = [{ t: at / spd, fn: () => {
      const h = this.headWorld(_v);
      this.attacks.bunny({ x: h.x, y: h.y, z: h.z, enemies: this.game.enemies });
      if (Math.random() < 0.5) this.game.say('Vai, coelhinho!', { speaker: 'Druida', duration: 1200 });
    } }];
    this.seq = { t: 0, steps, end: dur / spd * 0.75 };
    this.chain = true;
  }

  // ---- deboche e mudança de fase -----------------------------------------------------------------------------
  _taunt(line = null) {
    this.mode = 'taunt';
    this._play('Taunt', { ts: 1.15, fade: 0.1 });
    const dur = this.animator.has('Taunt') ? this.animator.duration('Taunt') / 1.15 : 1.1;
    this.seq = { t: 0, steps: [], end: dur };
    const text = line ?? (Math.random() < 0.55 ? pick(LINES_TAUNT) : null);
    if (text) this.game.say(text, { speaker: 'Druida', duration: 2300 });
  }

  _phaseShift() {
    this.phase = this.pendingPhase;
    this.pendingPhase = 0;
    if (this.phase === 2) { this.forceNext = 'summon'; this._taunt(LINE_PHASE2); } else { this.forceNext = 'lightning'; this._taunt(LINE_PHASE3); }
    this.seq.end += 0.9;
  }

  // =============================================================================================
  // Cutscenes
  // =============================================================================================
  /** Entrou na clareira: o portão fecha, o diálogo acontece e a luta começa. */
  async startIntro() {
    if (this.state !== 'dormant') return;
    this.state = 'intro';
    const g = this.game, p = g.player;
    g.input.clear();
    p.lock('boss');
    g.ui.hidePrompt?.();
    this.forest.closeGate();
    await p.turnTo(this.pos);
    g.cameraRig.setShot('twoShot', { a: 'Aprendiz', b: 'Druida' });
    await wait(900);
    for (const l of INTRO_LINES) {
      if (this.state !== 'intro') return;
      if (l.speaker === 'Druida') this.animator.play('Idle_AFK', { fade: 0.2, fallback: ['Idle'] });
      await g.say(l.text, { speaker: l.speaker, duration: 1600 + l.text.length * 42 });
    }
    this.animator.play('Idle', { fade: 0.2 });
    if (this.state !== 'intro') return;
    g.cameraRig.setShot('default');
    g.ui.setObjective?.(OBJ_BOSS);
    p.unlock('boss');
    this._beginFight();
  }

  _beginFight() {
    const g = this.game;
    this.state = 'fight';
    this.hp = this.max;
    this.phase = 1;
    this.ghost = true;
    g.ui.showBossBar?.(BOSS_NAME, this.hp, this.max);
    g.cameraRig.extra = () => (this.state === 'fight' ? this.pos : null);
    g.hint?.('Espaço esquiva · botão direito (ou K) bloqueia · J ou clique ataca · Q chama o Broto Guardião', 6500);
    this._shadowStep(() => this._toGap(0.6), this._pickSpot());
  }

  /** O jogador caiu: o chefe volta ao cogumelo e a arena se reabre. */
  reset() {
    this.attacks.clear();
    this.game.ui.hideBossBar?.();
    this.game.cameraRig.extra = null;
    this.mount();
    this.forest.openGate(true);
  }

  async _defeat() {
    if (this.state !== 'fight') return;
    this.state = 'dying';
    this.mode = null;
    this.seq = null;
    this.tp = null;
    this.ghost = false;
    this.vis = 1;
    const g = this.game, p = g.player;
    this.attacks.clear();
    g.enemies.killSummoned();
    g.ui.hideBossBar?.();
    g.cameraRig.extra = null;
    g.input.clear();
    p.lock('boss');
    p.iframes = 120;                                   // ninguém a machuca durante a cena
    this._play('Defeat', { hold: true, fade: 0.1 });
    const c = this.centerWorld(new THREE.Vector3());
    g.sparkles.burst(c.x, c.y, c.z, 36, { speed: 2.4, life: 1.0, size: 0.09, gravity: -0.4, palette: PURPLE_PALETTE });
    g.puffs?.puff(c.x, 0.3, c.z, { colors: SHADOW_COLORS, count: 9, scale: 1.4, life: 0.7 });
    await wait(2300);
    g.cameraRig.setShot('twoShot', { a: 'Aprendiz', b: 'Druida' });
    await wait(500);
    const say = (l) => g.say(l.text, { speaker: l.speaker, duration: 1600 + l.text.length * 42 });
    for (const l of OUTRO_LINES) await say(l);
    // ela usa a magia de planta e a clareira floresce
    const cast = p.playAction('Cast_Lumos', { fade: 0.15 });
    await wait(900);
    const bloom = this.forest.bloomArena();
    await Promise.all([cast, bloom]);
    this.animator.play('Idle', { fade: 0.5 });
    this.once = null;
    await wait(500);
    this._play('Taunt', { ts: 0.9, fade: 0.2 });
    for (const l of OUTRO_AFTER_BLOOM) await say(l);
    // recompensa, caminho livre
    g.vitals.addMax(1);
    g.ui.toast?.(TOAST_REWARD, 3600);
    g.sparkles.burst(p.pos.x, p.pos.y + 0.9, p.pos.z, 40, { speed: 2.2, life: 1.2, size: 0.09, gravity: -0.6 });
    this.forest.openGate();
    g.ui.clearObjective?.();
    g.story.flags.druidDefeated = true;
    this.forest.onBossDefeated();
    setTimeout(() => g.ui.toast?.(TOAST_PATH_FREE, 2800), 1800);
    this.makeFriendly(this.pos.x, this.pos.z);
    g.cameraRig.setShot('default');
    p.iframes = 0;
    p.unlock('boss');
  }
}
