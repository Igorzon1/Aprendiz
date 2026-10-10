import * as THREE from 'three';
import { worldBox } from './Collision.js';
import { OUTDOOR_LOOK, WORLD_HALF } from './configWorld.js';
import { Emitter, clamp, yawOf } from './util.js';

const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

function nodeYaw(node) {
  node.getWorldQuaternion(_q);
  _v.set(0, 0, 1).applyQuaternion(_q);
  return yawOf(_v.x, _v.z);
}

function parseColor(v, fallback = '#ffe0b0') {
  try {
    if (typeof v === 'number') return new THREE.Color(v);
    if (typeof v === 'string') return new THREE.Color(/^[0-9a-f]{6}$/i.test(v.trim()) ? `#${v.trim()}` : v.trim());
  } catch { /* fallback */ }
  return new THREE.Color(fallback);
}

/**
 * O Vale dos Morangos (World01.glb): lê os nós do contrato (COL_*, INT_*, SPAWN_*, AREA_*, ITEM_*, ENEMY_*, NPC_*,
 * LIGHT_*), cria colisores, luzes (sol com sombra que segue a Aprendiz) e detecta a área em que ela está.
 * Mesma "forma" do World da casa (interactables, spawns, point, update), para o resto do jogo usar igual.
 * Evento: 'area' ({name, title, subtitle}).
 */
export class OutdoorWorld extends Emitter {
  /**
   * @param {THREE.Scene} scene
   * @param {{scene:THREE.Object3D}} asset
   * @param {import('./Collision.js').Collision} collision
   */
  constructor(scene, asset, collision) {
    super();
    this.scene = scene;
    this.collision = collision;
    this.kind = 'outdoor';
    this.root = asset.scene;
    this.root.name = 'World01';
    this.lightGroup = new THREE.Group();
    this.lightGroup.name = 'OutdoorLights';
    scene.add(this.root, this.lightGroup);
    this.root.updateMatrixWorld(true);

    this.byName = new Map();
    this.interactables = [];
    this.spawns = {};
    this.lights = [];
    this.areas = [];
    this.items = [];          // {id, pos}
    this.enemyNodes = [];     // {id, x, z, yaw, territory}
    this.hinges = new Map();
    this.fridge = null;
    this.dummy = null;
    this.fridgeLight = null;
    this.strawberryTemplate = null;
    this.npcSpot = null;      // {pos, yaw}
    this.time = 0;
    this.area = null;

    const toHide = [];
    this.root.traverse((o) => { if (o.name && !this.byName.has(o.name)) this.byName.set(o.name, o); });
    this.root.traverse((o) => {
      const n = o.name || '';
      const ud = o.userData || {};
      if (n.startsWith('COL_')) {
        collision.addBox(worldBox(o), n);
        toHide.push(o);
      } else if (n.startsWith('INT_')) {
        this.interactables.push({
          id: n,
          kind: String(ud.kind ?? n.slice(4).toLowerCase()),
          prompt: String(ud.prompt ?? 'Interagir'),
          radius: Math.min(Number(ud.radius) || 1, 1.3),   // raio pequeno: o prompt só aparece bem perto
          pos: o.getWorldPosition(new THREE.Vector3()),
          node: o,
          area: ud.area ? String(ud.area) : null,
        });
      } else if (n.startsWith('SPAWN_')) {
        this.spawns[n.slice(6)] = { pos: o.getWorldPosition(new THREE.Vector3()), yaw: nodeYaw(o) };
      } else if (n.startsWith('AREA_')) {
        this.areas.push({
          name: n.slice(5), title: String(ud.title ?? n.slice(5)), subtitle: String(ud.subtitle ?? ''),
          radius: Number(ud.radius) || 8, pos: o.getWorldPosition(new THREE.Vector3()),
        });
      } else if (/^ITEM_Strawberry_\d+$/.test(n)) {
        this.items.push({ id: n, pos: o.getWorldPosition(new THREE.Vector3()) });
      } else if (n.startsWith('ENEMY_')) {
        const p = o.getWorldPosition(new THREE.Vector3());
        this.enemyNodes.push({ id: n, x: p.x, z: p.z, yaw: nodeYaw(o), territory: Number(ud.territory) || 3.5 });
      } else if (n === 'NPC_Divonica') {
        this.npcSpot = { pos: o.getWorldPosition(new THREE.Vector3()), yaw: nodeYaw(o) };
      } else if (n.startsWith('LIGHT_')) {
        this._makeLight(o);
      } else if (n === 'Prop_GoldenStrawberry') {
        this.strawberryTemplate = o;
        toHide.push(o);
      }
    });
    for (const o of toHide) o.visible = false;
    this.items.sort((a, b) => a.id.localeCompare(b.id));
    this.enemyNodes.sort((a, b) => a.id.localeCompare(b.id));

    const H = WORLD_HALF - 1.5;
    this.bounds = { minX: -H, maxX: H, minZ: -H, maxZ: H };
    collision.setBounds(-WORLD_HALF, WORLD_HALF, -WORLD_HALF, WORLD_HALF);

    this._setupLighting();
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.name || '';
      if (n.startsWith('COL_') || n === 'Prop_GoldenStrawberry') { o.castShadow = false; o.receiveShadow = false; return; }
      // o chão e os decalques só recebem sombra (não faz sentido projetar)
      o.castShadow = !/^(Ground|Paths|Plaza)/.test(n);
      o.receiveShadow = true;
    });
  }

  get look() { return OUTDOOR_LOOK; }

  _makeLight(node) {
    const ud = node.userData || {};
    const intensity = clamp(Number(ud.intensity) || 1, 0, 40);
    const light = new THREE.PointLight(parseColor(ud.color), intensity, Number(ud.distance) || 6, 2);
    light.position.copy(node.getWorldPosition(new THREE.Vector3()));
    this.lightGroup.add(light);
    const flicker = /lantern|lava|glow|spirit/i.test(node.name) ? (/lava/i.test(node.name) ? 0.2 : 0.1) : 0;
    this.lights.push({ light, base: intensity, flicker, phase: Math.random() * 10 });
  }

  _setupLighting() {
    const L = OUTDOOR_LOOK;
    const hemi = new THREE.HemisphereLight(L.hemi.sky, L.hemi.ground, L.hemi.intensity);
    const sun = new THREE.DirectionalLight(L.sun.color, L.sun.intensity);
    sun.castShadow = true;
    const half = L.shadowHalf;
    sun.shadow.camera.left = -half; sun.shadow.camera.right = half;
    sun.shadow.camera.top = half; sun.shadow.camera.bottom = -half;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 70;
    sun.shadow.mapSize.set(L.shadowMapSize, L.shadowMapSize);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 3;
    this.lightGroup.add(hemi, sun, sun.target);
    this.sun = sun;
    this.hemi = hemi;
    this._texel = (2 * half) / L.shadowMapSize;
    sun.position.set(...L.sun.offset);
  }

  setActive(on) {
    this.root.visible = on;
    this.lightGroup.visible = on;
  }

  point(name, out = new THREE.Vector3()) {
    const o = this.byName.get(name);
    return o ? o.getWorldPosition(out) : null;
  }

  /** Área (AREA_*) de menor raio que contém o ponto. */
  areaAt(x, z) {
    let best = null;
    for (const a of this.areas) {
      if (Math.hypot(x - a.pos.x, z - a.pos.z) <= a.radius && (!best || a.radius < best.radius)) best = a;
    }
    return best;
  }

  /** `focus`: ponto que a sombra do sol segue (a Aprendiz); `player`: para detectar a área. */
  update(dt, focus = null, player = null) {
    this.time += dt;
    for (const l of this.lights) {
      if (l.flicker) l.light.intensity = l.base * (1 + l.flicker * Math.sin(this.time * 6 + l.phase) * Math.sin(this.time * 2.3 + l.phase * 2));
    }
    if (focus) {
      const t = this._texel;
      const fx = Math.round(focus.x / t) * t, fz = Math.round(focus.z / t) * t;
      const o = OUTDOOR_LOOK.sun.offset;
      this.sun.position.set(fx + o[0], o[1], fz + o[2]);
      this.sun.target.position.set(fx, 0, fz);
    }
    if (player) {
      const a = this.areaAt(player.x, player.z);
      if (a !== this.area) {
        this.area = a;
        if (a) this.emit('area', a);
      }
    }
  }
}
