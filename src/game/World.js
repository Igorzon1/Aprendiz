import * as THREE from 'three';
import { worldBox } from './Collision.js';
import { RENDER } from './config.js';
import { Emitter, clamp, easeInOutCubic, easeOutBack, yawOf } from './util.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const AXIS = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
// Raio máximo de gatilho por tipo de INT_* (raio grande demais no Blender dispara de longe). Outros tipos: 0.9.
const MAX_RADIUS = { cauldron: 0.55, bookshelf: 0.7, plush: 0.7, bed: 0.7, window: 0.7 };

/** Cor vinda do userData do Blender: número (0xRRGGBB), "#rrggbb", "rrggbb" ou nome CSS. */
function parseColor(v, fallback = '#ffd9a8') {
  try {
    if (typeof v === 'number') return new THREE.Color(v);
    if (typeof v === 'string') {
      const s = v.trim();
      if (/^[0-9a-f]{6}$/i.test(s)) return new THREE.Color(`#${s}`);
      return new THREE.Color(s);
    }
    if (Array.isArray(v) && v.length >= 3) return new THREE.Color().setRGB(v[0], v[1], v[2]);
  } catch { /* cai no fallback */ }
  return new THREE.Color(fallback);
}

/** Yaw (rotação em Y) para onde o empty "olha" (+Z local). */
function nodeYaw(node) {
  node.getWorldQuaternion(_q);
  _v.set(0, 0, 1).applyQuaternion(_q);
  return yawOf(_v.x, _v.z);
}

/** Objeto articulado com mola (porta da portinhola) em torno de um eixo local. */
class Hinge {
  /**
   * @param {THREE.Object3D} node  origem na dobradiça
   * @param {'x'|'y'|'z'} axis
   * @param {number} openRad  ângulo (rad) da posição aberta
   */
  constructor(node, axis, openRad) {
    this.node = node;
    this.axis = AXIS[axis] ?? AXIS.y;
    this.base = node.quaternion.clone();
    this.openRad = openRad;
    this.angle = 0;
    this.vel = 0;
    this.target = 0;
    this.k = 140;
    this.c = 2 * Math.sqrt(140) * 0.85;
    this.waiters = [];
    this.timer = 0;
  }

  /** Vai para `target` (rad) com mola; `wobble` deixa o balanço mais solto. Promise ao assentar. */
  goTo(target, { wobble = false } = {}) {
    this.target = target;
    this.k = wobble ? 120 : 160;
    this.c = 2 * Math.sqrt(this.k) * (wobble ? 0.2 : 0.8);
    this.timer = 0;
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  open(opts) { return this.goTo(this.openRad, opts); }
  close(opts) { return this.goTo(0, opts); }

  update(dt) {
    const steps = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.vel += (-this.k * (this.angle - this.target) - this.c * this.vel) * h;
      this.angle += this.vel * h;
    }
    _qy.setFromAxisAngle(this.axis, this.angle);
    this.node.quaternion.copy(this.base).multiply(_qy);
    this.timer += dt;
    const settled = Math.abs(this.angle - this.target) < 0.05 && Math.abs(this.vel) < 0.4;
    if (this.waiters.length && (settled || this.timer > 1.4)) {
      const w = this.waiters;
      this.waiters = [];
      w.forEach((r) => r());
    }
  }
}

/** Geladeira: porta com tween de ~0.6 s, luz interna e morangos. */
class Fridge extends Emitter {
  constructor(world, door) {
    super();
    this.world = world;
    this.door = door;
    this.base = door.quaternion.clone();
    const deg = Number(door.userData?.open_angle_deg);
    this.openAngle = THREE.MathUtils.degToRad(Number.isFinite(deg) ? deg : -100);
    this.open = false;
    this.t = 0; // 0 fechada .. 1 aberta
    this.dir = 0;
    this.duration = 0.6;
    this.berries = world.byName.get('Fridge_Strawberries') ?? null;
    this.lightNode = world.byName.get('Fridge_Light') ?? null;
    this.center = worldBox(door).getCenter(new THREE.Vector3()); // posição do centro da porta fechada
    this.lightMats = [];
    if (this.lightNode) {
      // clona o material para poder acender/apagar só o painel
      this.lightNode.traverse((o) => {
        if (o.isMesh && o.material) {
          o.material = o.material.clone();
          this.lightMats.push({ mat: o.material, base: o.material.emissiveIntensity ?? 1 });
        }
      });
    }
    // luz interna: usa o LIGHT_Fridge da casa, se existir; senão cria uma
    this.houseLight = world.fridgeLight ?? null;
    if (!this.houseLight) {
      const pl = new THREE.PointLight('#fff1f4', 0, 2.4, 2);
      pl.position.copy(this.lightNode ? this.lightNode.getWorldPosition(new THREE.Vector3()) : this.center.clone());
      world.lightGroup.add(pl);
      this.houseLight = { light: pl, base: 1.6 };
    }
    this._apply(0);
  }

  set(open) {
    if (open === this.open && this.dir === (open ? 1 : -1)) return;
    this.open = open;
    this.dir = open ? 1 : -1;
    this.emit(open ? 'opening' : 'closing');
  }

  _apply(t) {
    const e = this.dir >= 0 ? easeOutBack(t, 0.9) : easeInOutCubic(t);
    _qy.setFromAxisAngle(AXIS.y, this.openAngle * e);
    this.door.quaternion.copy(this.base).multiply(_qy);
    // painel apagado com a porta fechada; acende e "brilha" ao abrir
    const glow = clamp((t - 0.1) / 0.6, 0, 1);
    for (const { mat, base } of this.lightMats) mat.emissiveIntensity = base * (0.08 + 0.92 * glow);
    this.houseLight.light.intensity = this.houseLight.base * 1.5 * glow;
  }

  update(dt) {
    if (!this.dir) return;
    this.t = clamp(this.t + (this.dir * dt) / this.duration, 0, 1);
    this._apply(this.t);
    if ((this.dir > 0 && this.t >= 1) || (this.dir < 0 && this.t <= 0)) {
      this.dir = 0;
      this.emit(this.open ? 'opened' : 'closed');
    }
  }
}

/** Boneco de treino: mola amortecida em torno da base. */
class Dummy {
  constructor(node) {
    this.node = node;
    this.base = node.quaternion.clone();
    this.box = worldBox(node);
    this.center = this.box.getCenter(new THREE.Vector3());
    this.tx = 0; this.tz = 0;   // inclinação (rad) em torno dos eixos X e Z
    this.vx = 0; this.vz = 0;
    this.hits = 0;
  }

  /** Empurra o boneco na direção (dx, dz) (unitária no plano XZ). */
  hit(dx, dz, strength = 5) {
    // topo se inclina para a direção do tiro: eixo = (dz, 0, -dx)
    this.vx += dz * strength;
    this.vz += -dx * strength;
    this.hits++;
  }

  update(dt) {
    const k = 70, c = 3.4;
    const steps = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.vx += (-k * this.tx - c * this.vx) * h;
      this.vz += (-k * this.tz - c * this.vz) * h;
      this.tx += this.vx * h;
      this.tz += this.vz * h;
    }
    if (Math.abs(this.tx) + Math.abs(this.tz) + Math.abs(this.vx) + Math.abs(this.vz) < 1e-4) {
      this.tx = this.tz = this.vx = this.vz = 0;
      return;
    }
    const lim = 0.5;
    _q.setFromEuler(new THREE.Euler(clamp(this.tx, -lim, lim), 0, clamp(this.tz, -lim, lim), 'XYZ'));
    this.node.quaternion.copy(_q).multiply(this.base);
  }
}

/**
 * O cenário: lê a House (real ou placeholder) seguindo as convenções do contrato,
 * cria colisores, pontos de interação, spawns, luzes e as peças animadas (geladeira, boneco, portinhola).
 */
export class World {
  /**
   * @param {THREE.Scene} scene
   * @param {{scene:THREE.Object3D}} houseAsset
   * @param {import('./Collision.js').Collision} collision
   */
  constructor(scene, houseAsset, collision) {
    this.scene = scene;
    this.collision = collision;
    this.kind = 'house';
    this.lightGroup = new THREE.Group();   // todas as luzes da casa (some junto quando o cenário troca)
    this.lightGroup.name = 'HouseLights';
    scene.add(this.lightGroup);
    this.root = houseAsset.scene;
    scene.add(this.root);
    this.root.updateMatrixWorld(true);

    this.byName = new Map();
    this.interactables = [];
    this.spawns = {};
    this.lights = [];
    this.fridgeLight = null;
    this.hinges = new Map();
    this.fridge = null;
    this.dummy = null;
    this.time = 0;

    const colBoxes = [];
    const toHide = [];
    this.root.traverse((o) => {
      if (o.name && !this.byName.has(o.name)) this.byName.set(o.name, o);
    });
    this.root.traverse((o) => {
      const n = o.name || '';
      if (n.startsWith('COL_')) {
        colBoxes.push(worldBox(o));
        collision.addBox(colBoxes[colBoxes.length - 1], n);
        toHide.push(o);
      } else if (n.startsWith('INT_')) {
        const ud = o.userData || {};
        const kind = String(ud.kind ?? n.slice(4).toLowerCase());
        this.interactables.push({
          id: n,
          kind,
          prompt: String(ud.prompt ?? 'Interagir'),
          radius: Math.min(Number(ud.radius) || 1.2, MAX_RADIUS[kind] ?? 0.9),
          pos: o.getWorldPosition(new THREE.Vector3()),
          node: o,
        });
      } else if (n.startsWith('SPAWN_')) {
        this.spawns[n.slice(6)] = { pos: o.getWorldPosition(new THREE.Vector3()), yaw: nodeYaw(o) };
      } else if (n.startsWith('LIGHT_')) {
        this._makeLight(o);
      }
    });
    for (const o of toHide) o.visible = false;

    // Limites: união dos colisores (paredes) ou, na falta deles, das malhas visíveis.
    const visibleBox = new THREE.Box3();
    this.root.traverse((o) => {
      if ((o.isMesh) && o.visible && !(o.name || '').startsWith('COL_')) visibleBox.union(worldBox(o));
    });
    const b = new THREE.Box3();
    if (colBoxes.length >= 3) colBoxes.forEach((c) => b.union(c)); else b.copy(visibleBox);
    if (b.isEmpty()) b.set(new THREE.Vector3(-3, 0, -2.5), new THREE.Vector3(3, 2.5, 2.5));
    this.bounds = { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z };
    this.visibleBounds = visibleBox;
    collision.setBounds(this.bounds.minX, this.bounds.maxX, this.bounds.minZ, this.bounds.maxZ);

    // Peças animadas
    const door = this.byName.get('Fridge_Door');
    if (door) this.fridge = new Fridge(this, door);
    const dummy = this.byName.get('Dummy');
    if (dummy) this.dummy = new Dummy(dummy);
    const flap = this.byName.get('CatFlap');
    if (flap) {
      const ud = flap.userData || {};
      const axis = ud.swing_axis === 'x' ? 'x' : 'z';
      // swing_inward_sign (opcional, do Blender): +1/-1 para que o ângulo positivo abra para dentro
      const sign = Number(ud.swing_inward_sign) < 0 ? -1 : 1;
      const ang = (Number.isFinite(Number(ud.swing_angle_deg)) ? Number(ud.swing_angle_deg) : 60) * sign;
      this.hinges.set('CatFlap', new Hinge(flap, axis, THREE.MathUtils.degToRad(ang)));
    }

    this._setupLighting();
    this._setupShadows();
  }

  _makeLight(node) {
    const ud = node.userData || {};
    const color = parseColor(ud.color);
    const intensity = clamp((Number(ud.intensity) || 1) * RENDER.pointLightScale, 0, 40);
    const distance = Number(ud.distance) || 6;
    const light = new THREE.PointLight(color, intensity, distance, 2);
    light.position.copy(node.getWorldPosition(new THREE.Vector3()));
    this.lightGroup.add(light);
    if (/fridge|geladeira/i.test(node.name)) {
      // a luz da geladeira só acende com a porta aberta (controlada pela classe Fridge)
      light.intensity = 0;
      this.fridgeLight = { light, base: intensity };
      return;
    }
    const flicker = /cauldron|candle|fire|fireplace|lareira/i.test(node.name) ? 0.12 : 0;
    this.lights.push({ light, base: intensity, flicker, phase: Math.random() * 10 });
  }

  _setupLighting() {
    const b = this.bounds;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);

    const hemi = new THREE.HemisphereLight(RENDER.hemi.sky, RENDER.hemi.ground, RENDER.hemi.intensity);
    this.lightGroup.add(hemi);

    // Sol quente vindo da frente/alto (a frente da casa é aberta)
    const sun = new THREE.DirectionalLight(RENDER.sun.color, RENDER.sun.intensity);
    sun.position.set(cx + size * 0.45, size * 1.1, cz + size * 0.8);
    sun.target.position.set(cx, 0, cz);
    sun.castShadow = true;
    const half = size * 0.75;
    sun.shadow.camera.left = -half; sun.shadow.camera.right = half;
    sun.shadow.camera.top = half; sun.shadow.camera.bottom = -half;
    sun.shadow.camera.near = 0.5; sun.shadow.camera.far = size * 3.5;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.025;
    sun.shadow.radius = 3; // PCF suave
    this.lightGroup.add(sun, sun.target);
    this.sun = sun;
    this.hemi = hemi;
  }

  _setupShadows() {
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      if ((o.name || '').startsWith('COL_')) { o.castShadow = false; o.receiveShadow = false; return; }
      o.castShadow = true;
      o.receiveShadow = true;
    });
  }

  /** Liga/desliga o cenário inteiro (malhas e luzes). */
  setActive(on) {
    this.root.visible = on;
    this.lightGroup.visible = on;
  }

  /** Aparência do cenário (fundo e névoa), usada pelo SceneManager. */
  get look() { return { background: RENDER.background, fog: null }; }

  /** Nó (ou posição) do cenário pelo nome. */
  point(name, out = new THREE.Vector3()) {
    const o = this.byName.get(name);
    return o ? o.getWorldPosition(out) : null;
  }

  update(dt) {
    this.time += dt;
    this.fridge?.update(dt);
    this.dummy?.update(dt);
    for (const h of this.hinges.values()) h.update(dt);
    for (const l of this.lights) {
      if (l.flicker) l.light.intensity = l.base * (1 + l.flicker * Math.sin(this.time * 7 + l.phase) * Math.sin(this.time * 3.1 + l.phase * 2));
    }
  }
}
