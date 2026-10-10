import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { Animator } from './Animator.js';
import { EnemyBrain, ST } from './EnemyBrain.js';
import { SOMBRITO as C, SOMBRITO_VARIANTS } from './configCombat.js';
import { Health } from './Health.js';
import { Emitter, angleDiff, clamp, dampAngle, easeOutBack, yawOf } from './util.js';

const BASE = import.meta.env.BASE_URL || '/';
const DATA_URL = `${BASE}assets/data/animations.json`;

/** Eventos (quadro @30fps) usados quando o animations.json não os traz ou o clip ainda não existe. */
const DEFAULT_EVENTS = {
  Attack: { hit: 14 },
  Alert: { noticed: 6 },
  Spawn: { can_act: 30 },
};

// =================================================================================================
// Carregamento do modelo (ShadowMinion.glb), com cache e placeholder caso o arquivo não exista
// =================================================================================================
const _loading = {};   // GLB name -> Promise (one load per variant model)

const isGLB = (buf) => !!buf && buf.byteLength > 12 && new DataView(buf).getUint32(0, true) === 0x46546c67;

function fixTexture(tex) {
  if (!tex || !tex.isTexture) return;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
}

function mergeEvents(fromJson = {}) {
  const out = {};
  for (const [clip, evs] of Object.entries(DEFAULT_EVENTS)) out[clip] = { ...evs };
  for (const [clip, evs] of Object.entries(fromJson)) out[clip] = { ...(out[clip] ?? {}), ...evs };
  return out;
}

/** Sombrito feito de formas simples, usado se o GLB não carregar. */
function buildPlaceholderMinion() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#3a2552', roughness: 0.8, emissive: '#2a1040', emissiveIntensity: 0.6 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 10), mat);
  body.scale.set(1, 1.15, 1);
  body.position.y = 0.2;
  g.add(body);
  const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.6, 2.6), toneMapped: false });
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), eyeMat);
    eye.position.set(sx * 0.055, 0.26, 0.15);
    g.add(eye);
  }
  return g;
}

async function loadAsset(assets, name = 'ShadowMinion') {
  // 1. O agente de assets pode passar a carregar o Sombrito no futuro: se já estiver lá, usa.
  const given = name === 'ShadowMinion' ? (assets?.models?.shadowMinion ?? assets?.models?.minion ?? assets?.models?.sombrito) : null;
  if (given?.scene) {
    return { scene: given.scene, clips: given.clips ?? new Map(), events: mergeEvents(given.events), fps: given.fps ?? 30, placeholder: false };
  }

  let events = assets?.animData?.[name]?.events;
  let fps = assets?.animData?.[name]?.fps ?? 30;
  if (!events) {
    try {
      const res = await fetch(DATA_URL);
      if (res.ok) {
        const d = JSON.parse(await res.text());
        events = d[name]?.events;
        fps = d[name]?.fps ?? fps;
      }
    } catch { /* usa os eventos padrão */ }
  }

  try {
    const res = await fetch(`${BASE}assets/models/${name}.glb`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (!isGLB(buf)) throw new Error('não é um GLB');
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.parseAsync(buf, `${BASE}assets/models/`);
    const clips = new Map();
    for (const clip of gltf.animations) {
      clip.name = clip.name.replace(new RegExp(`^${name}_`), '');
      clips.set(clip.name, clip);
    }
    gltf.scene.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      if (o.isSkinnedMesh) o.frustumCulled = false;
      o.castShadow = true;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        for (const key of ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) fixTexture(m[key]);
      }
    });
    return { scene: gltf.scene, clips, events: mergeEvents(events), fps, placeholder: false };
  } catch (err) {
    console.warn(`[Enemy] ${name}.glb indisponível, usando Sombrito placeholder:`, err?.message ?? err);
    return { scene: buildPlaceholderMinion(), clips: new Map(), events: mergeEvents(events), fps, placeholder: true };
  }
}

/** Carrega (uma vez) o modelo e os dados de animação do Sombrito. Promise com {scene, clips, events, fps}. */
export function loadSombritoAsset(assets = null, name = 'ShadowMinion') {
  _loading[name] ??= loadAsset(assets, name);
  return _loading[name];
}

// =================================================================================================
// Clarão branco por instância (uniform no shader: sem recompilar nada ao piscar)
// =================================================================================================
function flashHook(shader) {
  shader.uniforms.uFlash = this.userData.flash;
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'uniform float uFlash;\nvoid main() {')
    .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n  gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.9, 1.7, 2.2), uFlash);');
}

function makeFlashable(mat) {
  mat.userData.flash = { value: 0 };
  mat.onBeforeCompile = flashHook;
  mat.customProgramCacheKey = () => 'sombrito-flash';
  mat.needsUpdate = true;
}

const _tmp = new THREE.Vector3();

// =================================================================================================
// O corpo do Sombrito
// =================================================================================================
/**
 * Corpo de um Sombrito: modelo, animações, movimento (com colisão e separação), reações visuais.
 * As decisões ficam no EnemyBrain. `ctx` é o gerenciador `Enemies` (collision, nav, fx, target...).
 */
export class Enemy extends Emitter {
  /**
   * @param {import('./Enemies.js').Enemies} ctx
   * @param {{scene:THREE.Object3D, clips:Map, events:object, fps:number}} asset
   * @param {{id:string, x:number, z:number, yaw?:number, territory?:number}} o
   */
  constructor(ctx, asset, { id, x, z, yaw = 0, territory = C.territoryDefault, variant = 'base' }) {
    super();
    this.variant = variant;
    this.C = { ...C, ...(SOMBRITO_VARIANTS[variant] ?? {}) };
    this.ctx = ctx;
    this.id = id;
    this.territory = territory;
    this.spawn = { x, z, yaw };
    this.radius = this.C.radius;
    this.height = this.C.height;

    this.root = new THREE.Group();
    this.root.name = id;
    this.body = new THREE.Group(); // squash, pulinho e escala procedural ficam aqui
    this.root.add(this.body);
    this.model = cloneSkinned(asset.scene);
    this.model.scale.multiplyScalar(this.C.modelScale);
    this.body.add(this.model);

    // materiais próprios (o clarão é por instância)
    this.mats = [];
    this.model.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      o.castShadow = true;
      o.receiveShadow = false;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      const cloned = list.map((m) => {
        if (!m) return m;
        const c = m.clone();
        makeFlashable(c);
        this.mats.push(c);
        return c;
      });
      o.material = Array.isArray(o.material) ? cloned : cloned[0];
    });

    this.animator = new Animator(this.model, asset.clips, asset.events, { fps: asset.fps });
    this.animator.on('event', (clip, evt) => this.emit('animEvent', clip, evt));
    this.animator.on('finished', (clip) => this._onFinished(clip));

    this.health = new Health(this.C.hp);

    this.pos = this.root.position;
    this.yaw = yaw;
    this.vx = 0;
    this.vz = 0;
    this.kvx = 0;       // empurrão (knockback / bote), decai sozinho
    this.kvz = 0;
    this.speed = 0;

    // movimento
    this.goal = null;   // {x, z, speed, stop}
    this.arrived = true;
    this.path = null;
    this.pathGoal = { x: 0, z: 0 };
    this.repathT = 0;
    this.losT = 0;
    this.los = true;
    this.face = null;   // {x, z}
    this.stuckT = 0;
    this.stuck = false;

    // animação
    this.once = null;   // {name, cb}
    this.idleClip = 'Idle';
    this.moving = false;
    this.curLoco = null;

    // reações visuais
    this.flash = 0;
    this.sq = 0;        // squash (deslocamento da mola) ...
    this.sqv = 0;       // ... e velocidade
    this.hopT = -1;
    this.hopDur = 0.38;
    this.pscale = 1;    // escala procedural (nascer/derreter quando o clip não existe)
    this.pscaleAnim = null;

    this.place(x, z, yaw);
    this.animator.play('Idle', { fade: 0 });
    this.animator.update(0.001);

    this.brain = new EnemyBrain(this, ctx);
  }

  // -----------------------------------------------------------------------------------------------
  get targetable() { return this.brain.targetable; }
  get dead() { return this.health.isDead; }

  /** Centro (para mirar) em coordenadas de mundo. */
  centerWorld(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.C.centerY, this.pos.z); }
  headWorld(out = new THREE.Vector3()) { return out.set(this.pos.x, this.pos.y + this.C.height + 0.12, this.pos.z); }
  distTo(x, z) { return Math.hypot(this.pos.x - x, this.pos.z - z); }

  place(x, z, yaw = this.yaw) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
    this.vx = this.vz = this.kvx = this.kvz = this.speed = 0;
    this.goal = null;
    this.path = null;
    this.arrived = true;
  }

  /** Renasce em casa com vida cheia. */
  resetToSpawn() {
    this.health.reset();
    this.place(this.spawn.x, this.spawn.z, this.spawn.yaw);
    this.flash = 0;
    this.sq = this.sqv = 0;
    this.hopT = -1;
    this.once = null;
    this.curLoco = null;
    this.setPScale(1);
    this.root.visible = true;
  }

  // -----------------------------------------------------------------------------------------------
  // Comandos (usados pelo cérebro)
  // -----------------------------------------------------------------------------------------------
  /** Anda até (x, z). Chamar a cada quadro com o mesmo destino é barato. */
  moveTo(x, z, speed, stop = 0.08) {
    const g = this.goal;
    if (g) { g.x = x; g.z = z; g.speed = speed; g.stop = stop; return; }
    this.goal = { x, z, speed, stop };
    this.arrived = false;
    this.stuck = false;
    this.stuckT = 0;
    this.path = null;
    this.losT = 0;
  }

  stop() { this.goal = null; this.path = null; this.arrived = true; }

  faceTo(x, z) { this.face = x === null ? null : { x, z }; }

  /** Empurrão instantâneo (m/s) na direção (dx, dz) (normaliza). */
  kick(dx, dz, strength) {
    const l = Math.hypot(dx, dz) || 1;
    this.kvx += (dx / l) * strength;
    this.kvz += (dz / l) * strength;
  }

  setIdleClip(name) { this.idleClip = name; }

  playOnce(name, cb = null, { fade = 0.12, timeScale = 1 } = {}) {
    this.once = { name, cb };
    this.curLoco = null;
    this.animator.play(name, { fade, timeScale, fallback: ['Idle'] });
  }

  cancelOnce() { this.once = null; this.curLoco = null; }

  has(clip) { return this.animator.has(clip); }

  /** Pulinho procedural (reação "!" quando o clip Alert não existe). */
  hop() { this.hopT = 0; }

  squash(amount = 0.8) { this.sq = amount; this.sqv = 0; }

  /** Escala procedural 0..1 (nascer / derreter) para clips ausentes. */
  procScale(dir, dur) { this.pscaleAnim = { dir, dur, t: 0 }; if (dir > 0) this.pscale = 0.001; }
  setPScale(v) { this.pscale = v; this.pscaleAnim = null; }

  // -----------------------------------------------------------------------------------------------
  // Dano
  // -----------------------------------------------------------------------------------------------
  /**
   * Aplica dano (se puder). `fromX/fromZ` = de onde veio o golpe (empurra para longe).
   * Retorna true se o golpe valeu.
   */
  damage(n, fromX = null, fromZ = null) {
    if (!this.targetable) return false;
    const applied = this.health.damage(n);
    if (!applied) return false;
    const lethal = this.health.isDead;
    this.flash = 1;
    this.squash(lethal ? 1 : 0.85);
    if (fromX !== null) this.kick(this.pos.x - fromX, this.pos.z - fromZ, lethal ? this.C.knockback * 1.15 : this.C.knockback);
    this.ctx.fx.hitSpark(this.pos.x, this.pos.y + this.C.centerY, this.pos.z);
    this.brain.onDamaged(lethal);
    this.emit('damaged', this, applied);
    return true;
  }

  // -----------------------------------------------------------------------------------------------
  _onFinished(clip) {
    const o = this.once;
    if (o && o.name === clip) {
      this.once = null;
      this.curLoco = null;
      o.cb?.();
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Atualização
  // -----------------------------------------------------------------------------------------------
  update(dt) {
    this.brain.update(dt);
    if (this.brain.state === ST.DEAD) return;
    this._move(dt);
    this._visuals(dt);
    this._updateAnimation();
    this.animator.update(dt);
  }

  /** Próximo ponto a perseguir (direto, se a linha estiver livre; senão pelo A* da grade). */
  _waypoint(dt) {
    const g = this.goal;
    const p = this.pos;
    const col = this.ctx.collision;
    const nav = this.ctx.nav;
    const d = Math.hypot(g.x - p.x, g.z - p.z);
    if (d <= g.stop) { this.goal = null; this.path = null; this.arrived = true; return null; }

    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.12 + Math.random() * 0.06;
      this.los = col.segmentFree(p.x, p.z, g.x, g.z, this.radius * 0.8, this.height);
    }
    if (this.los || !nav) { this.path = null; return { x: g.x, z: g.z, d }; }

    this.repathT -= dt;
    const goalMoved = Math.hypot(g.x - this.pathGoal.x, g.z - this.pathGoal.z) > 0.7;
    if (!this.path || this.repathT <= 0 || goalMoved) {
      this.repathT = 0.7;
      this.pathGoal.x = g.x; this.pathGoal.z = g.z;
      this.path = nav.findPath(p.x, p.z, g.x, g.z);
    }
    if (this.path) {
      while (this.path.length > 1 && Math.hypot(this.path[0].x - p.x, this.path[0].z - p.z) < 0.14) this.path.shift();
      const wp = this.path[0];
      if (wp) return { x: wp.x, z: wp.z, d };
    }
    return { x: g.x, z: g.z, d };
  }

  _move(dt) {
    const pos = this.pos;
    let wantVx = 0, wantVz = 0, wantSpeed = 0;

    if (this.goal) {
      const g = this.goal;
      const wp = this._waypoint(dt);
      if (wp) {
        const dx = wp.x - pos.x, dz = wp.z - pos.z;
        const dl = Math.hypot(dx, dz) || 1;
        wantSpeed = g.speed;
        if (wp.d < g.stop + 0.45) wantSpeed *= clamp(0.4 + (wp.d - g.stop) / 0.45 * 0.6, 0.4, 1); // freia ao chegar
        const turn = Math.abs(angleDiff(this.yaw, yawOf(dx, dz)));
        wantSpeed *= clamp(1.25 - turn / 2.2, 0.35, 1);
        wantVx = (dx / dl) * wantSpeed;
        wantVz = (dz / dl) * wantSpeed;
      }
    }

    // separação suave: dos outros inimigos e da Aprendiz
    for (const n of this.ctx.neighborsOf(this)) {
      const dx = pos.x - n.pos.x, dz = pos.z - n.pos.z;
      const d = Math.hypot(dx, dz) || 1e-4;
      if (d < this.C.separation) {
        const push = ((this.C.separation - d) / this.C.separation) * 0.9;
        wantVx += (dx / d) * push;
        wantVz += (dz / d) * push;
      }
    }
    const pp = this.ctx.playerPos();
    if (pp) {
      const dx = pos.x - pp.x, dz = pos.z - pp.z;
      const d = Math.hypot(dx, dz) || 1e-4;
      if (d < this.C.playerKeepOff) {
        const push = ((this.C.playerKeepOff - d) / this.C.playerKeepOff) * 1.3;
        wantVx += (dx / d) * push;
        wantVz += (dz / d) * push;
      }
    }

    // suavização da velocidade
    const dvx = wantVx - this.vx, dvz = wantVz - this.vz;
    const dl = Math.hypot(dvx, dvz);
    if (dl > 1e-5) {
      const rate = (Math.hypot(wantVx, wantVz) > Math.hypot(this.vx, this.vz) ? this.C.accel : this.C.decel) * dt;
      const k = Math.min(1, rate / dl);
      this.vx += dvx * k;
      this.vz += dvz * k;
    }

    // integração + colisão
    const px = pos.x, pz = pos.z;
    pos.x += (this.vx + this.kvx) * dt;
    pos.z += (this.vz + this.kvz) * dt;
    const kd = Math.exp(-7 * dt);
    this.kvx *= kd; this.kvz *= kd;
    this.ctx.collision.resolve(pos, this.radius, this.height);
    this._enforceSeparation();
    const real = Math.hypot(pos.x - px, pos.z - pz) / Math.max(dt, 1e-4);
    this.speed += (real - this.speed) * (1 - Math.exp(-16 * dt));

    // travou num canto?
    if (this.goal && wantSpeed > 0.3 && this.speed < wantSpeed * 0.2) {
      this.stuckT += dt;
      if (this.stuckT > 1.0) { this.stuck = true; this.stuckT = 0; this.path = null; }
    } else {
      this.stuckT = Math.max(0, this.stuckT - dt * 2);
    }

    // direção do corpo
    let targetYaw = null;
    if (this.face) targetYaw = yawOf(this.face.x - pos.x, this.face.z - pos.z);
    else if (Math.hypot(this.vx, this.vz) > 0.09) targetYaw = yawOf(this.vx, this.vz);
    if (targetYaw !== null) this.yaw = dampAngle(this.yaw, targetYaw, this.C.turnLambda * (this.face ? 1.3 : 1), dt);
    this.root.rotation.y = this.yaw;
  }

  /** Distância mínima dura entre inimigos e para a Aprendiz. */
  _enforceSeparation() {
    const pos = this.pos;
    for (const n of this.ctx.neighborsOf(this)) {
      const dx = pos.x - n.pos.x, dz = pos.z - n.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < this.C.minDist) {
        const push = (this.C.minDist - d) * 0.5;
        const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
        pos.x += nx * push; pos.z += nz * push;
      }
    }
    const pp = this.ctx.playerPos();
    if (pp) {
      const dx = pos.x - pp.x, dz = pos.z - pp.z;
      const d = Math.hypot(dx, dz);
      const min = this.radius + 0.2 + 0.03; // raio dele + raio da Aprendiz
      if (d < min) {
        const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
        pos.x += nx * (min - d); pos.z += nz * (min - d);
      }
    }
    this.ctx.collision.resolve(pos, this.radius, this.height);
  }

  _visuals(dt) {
    // clarão
    this.flash = Math.max(0, this.flash - this.C.flash * dt);
    for (const m of this.mats) m.userData.flash.value = this.flash;

    // squash: mola amortecida em torno de 0
    const steps = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.sqv += (-170 * this.sq - 11 * this.sqv) * h;
      this.sq += this.sqv * h;
    }
    if (Math.abs(this.sq) < 1e-3 && Math.abs(this.sqv) < 1e-2) this.sq = this.sqv = 0;

    // pulinho
    let hopY = 0, hopSq = 0;
    if (this.hopT >= 0) {
      this.hopT += dt;
      const k = this.hopT / this.hopDur;
      if (k >= 1) this.hopT = -1;
      else { hopY = Math.sin(Math.PI * k) * 0.13; hopSq = -Math.sin(Math.PI * k) * 0.18; }
    }

    // escala procedural
    const a = this.pscaleAnim;
    if (a) {
      a.t += dt;
      const k = clamp(a.t / a.dur, 0, 1);
      this.pscale = a.dir > 0 ? Math.max(0.001, easeOutBack(k, 1.2)) : Math.max(0.001, 1 - k * k);
      if (k >= 1) { this.pscale = a.dir > 0 ? 1 : 0.001; this.pscaleAnim = null; }
    }

    const s = this.sq + hopSq;
    const sy = clamp(1 - s * 0.42, 0.45, 1.5);
    const sxz = clamp(1 + s * 0.3, 0.7, 1.45);
    this.body.scale.set(sxz * this.pscale, sy * this.pscale, sxz * this.pscale);
    this.body.position.y = hopY;
  }

  _updateAnimation() {
    if (this.once) return;
    // histerese: anda quando está indo (ou se movendo de verdade), para quando quase parou
    const commanded = !!this.goal && !this.arrived;
    if (this.moving) { if (!commanded && this.speed < 0.07) this.moving = false; }
    else if (commanded || this.speed > 0.14) this.moving = true;

    if (this.moving) {
      const ts = clamp(Math.max(this.speed, this.C.walkNominal * 0.4) / this.C.walkNominal, 0.6, 2.2);
      if (this.curLoco !== 'Walk') {
        this.animator.play('Walk', { fade: 0.15, timeScale: ts });
        this.curLoco = 'Walk';
      } else {
        this.animator.setTimeScale(ts);
      }
    } else if (this.curLoco !== this.idleClip) {
      this.animator.play(this.idleClip, { fade: 0.2 });
      this.curLoco = this.idleClip;
    }
  }

  /** Libera materiais clonados e o mixer. */
  dispose() {
    this.root.parent?.remove(this.root);
    this.animator.mixer.stopAllAction();
    this.animator.mixer.uncacheRoot(this.model);
    for (const m of this.mats) m.dispose();
    this.mats.length = 0;
  }
}

// reexporta para quem só precisa de um import
export { ST };
void _tmp;
