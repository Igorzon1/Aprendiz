import * as THREE from 'three';
import { CAMERA } from './config.js';
import { clamp, damp } from './util.js';

const _v = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _box = new THREE.Box3();
const _ray = new THREE.Raycaster();

/** Normais "para fora do cômodo" dos nomes de parede do contrato (Three.js: o lado da câmera é +Z). */
const NAMED_NORMALS = {
  back: [0, 0, -1],
  front: [0, 0, 1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
};

/** Nome da parede de um objeto: userData.wall (dele ou de um ancestral) ou `Wall_<Lado>` no nome. */
function wallKeyOf(obj) {
  for (let o = obj, i = 0; o && i < 4; o = o.parent, i++) {
    const w = o.userData?.wall;
    if (typeof w === 'string' && w) return w.toLowerCase();
    const m = /wall[_\-.]?(left|right|back|front)/i.exec(o.name || '');
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Esconde (com fade) as paredes que ficam entre a câmera e o alvo, e só elas.
 *
 * Entradas aceitas em `setOccluders(list)`: Object3D (malha ou nó) ou `{object, normal?}`. Objetos que
 * compartilham o mesmo `userData.wall` ('Left', 'Back'...) viram UMA unidade e somem juntos
 * (ex.: Wall_Left + Door + CatFlap). Objetos sem `wall` são unidades próprias.
 *
 * Teste por unidade, a cada quadro:
 *  - "parede" (a unidade tem normal conhecida: dada, deduzida da geometria ou do nome): a câmera está
 *    fora do plano externo da parede, o alvo dentro, e o segmento câmera->alvo atravessa a caixa da
 *    parede (assim uma parede por cima da qual a câmera olha não some à toa);
 *  - qualquer outro objeto: raycast câmera->alvo contra as malhas.
 * Para não piscar, a parede só volta depois de `holdBack` segundos livre.
 */
export class Occlusion {
  constructor() {
    this.units = [];
    this.enabled = true;
  }

  /** @param {(THREE.Object3D|{object:THREE.Object3D, normal?:THREE.Vector3|{x:number,z:number}})[]} list */
  setOccluders(list = []) {
    this.clear();
    const seenMesh = new Set();
    const byKey = new Map();

    for (const item of list ?? []) {
      if (!item) continue;
      const object = item.isObject3D ? item : item.object;
      if (!object?.isObject3D) continue;
      const explicit = item.isObject3D ? null : item.normal ?? null;
      const key = wallKeyOf(object);
      let unit;
      if (key && !explicit) {
        unit = byKey.get(key);
        if (!unit) { unit = this._newUnit(key); byKey.set(key, unit); this.units.push(unit); }
      } else {
        unit = this._newUnit(key);
        if (explicit) unit.normal = new THREE.Vector3(explicit.x ?? 0, 0, explicit.z ?? 0).normalize();
        this.units.push(unit);
      }
      unit.objects.push(object);
      object.traverse((o) => {
        if (o.isMesh && !seenMesh.has(o)) { seenMesh.add(o); unit.meshes.push(o); }
      });
    }

    for (const u of this.units) this._measure(u);
    this._inferNormals();
    for (const u of this.units) this._prepareMaterials(u);
  }

  _newUnit(key) {
    return {
      key,                       // 'left' | 'right' | 'back' | 'front' | null
      objects: [],
      meshes: [],
      box: new THREE.Box3(),
      inflated: new THREE.Box3(),
      center: new THREE.Vector3(),
      normal: null,              // Vector3 unitário (XZ) para fora do cômodo, se for parede
      halfThick: 0,
      thinAxis: null,            // 'x' | 'z'
      opacity: 1,
      target: 1,
      hold: 0,
      mats: new Map(),           // material original -> clone
      applied: -1,
    };
  }

  _measure(u) {
    u.box.makeEmpty();
    for (const o of u.objects) {
      o.updateWorldMatrix(true, true);
      u.box.union(_box.setFromObject(o));
    }
    u.box.getCenter(u.center);
    const sx = u.box.max.x - u.box.min.x;
    const sz = u.box.max.z - u.box.min.z;
    const thin = Math.min(sx, sz);
    const wide = Math.max(sx, sz);
    if (thin < 0.9 && thin < wide * 0.4) {
      u.thinAxis = sx < sz ? 'x' : 'z';
      u.halfThick = thin / 2;
    }
    const m = CAMERA.wall.margin;
    u.inflated.copy(u.box).expandByScalar(m);
  }

  /** Normal de cada parede: explícita > geometria (lado do cômodo) > nome do lado. */
  _inferNormals() {
    const walls = this.units.filter((u) => u.thinAxis && !u.normal);
    // centro do cômodo = união das paredes finas com eixos diferentes
    let room = null;
    const axes = new Set(this.units.filter((u) => u.thinAxis).map((u) => u.thinAxis));
    if (axes.size >= 2) {
      room = new THREE.Box3();
      for (const u of this.units) if (u.thinAxis) room.union(u.box);
    }
    for (const u of walls) {
      if (room) {
        const c = room.getCenter(_v);
        const d = u.thinAxis === 'x' ? u.center.x - c.x : u.center.z - c.z;
        if (Math.abs(d) > 0.3) {
          u.normal = new THREE.Vector3(u.thinAxis === 'x' ? Math.sign(d) : 0, 0, u.thinAxis === 'z' ? Math.sign(d) : 0);
          continue;
        }
      }
      const named = u.key && NAMED_NORMALS[u.key];
      if (named) {
        const n = new THREE.Vector3(named[0], 0, named[2]);
        // só vale se a normal nomeada é paralela ao eixo fino
        if ((u.thinAxis === 'x') === (n.x !== 0)) u.normal = n;
      }
    }
    // paredes nomeadas sem eixo fino claro (ex.: nó cheio): usa só o nome
    for (const u of this.units) {
      if (!u.normal && u.key && NAMED_NORMALS[u.key]) {
        const n = NAMED_NORMALS[u.key];
        u.normal = new THREE.Vector3(n[0], 0, n[2]);
        if (!u.halfThick) u.halfThick = 0.08;
      }
    }
  }

  _prepareMaterials(u) {
    for (const mesh of u.meshes) {
      const apply = (mat) => {
        if (!mat) return mat;
        let clone = u.mats.get(mat);
        if (!clone) {
          clone = mat.clone();
          clone.userData = { ...mat.userData, _occOrig: { transparent: mat.transparent, depthWrite: mat.depthWrite, opacity: mat.opacity } };
          // transparent fica ligado o tempo todo: ligar/desligar recompilaria o shader no meio do jogo
          clone.transparent = true;
          u.mats.set(mat, clone);
        }
        return clone;
      };
      mesh.userData._occOrigMat = mesh.material;
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(apply) : apply(mesh.material);
    }
  }

  /** Devolve os materiais originais e esquece as paredes. */
  clear() {
    for (const u of this.units) {
      for (const mesh of u.meshes) {
        if (mesh.userData._occOrigMat) { mesh.material = mesh.userData._occOrigMat; delete mesh.userData._occOrigMat; }
      }
      for (const clone of u.mats.values()) clone.dispose();
    }
    this.units = [];
  }

  /** Está escondida (ou quase) a parede com esse nome de lado? Útil para depuração/testes. */
  opacityOf(key) {
    const u = this.units.find((x) => x.key === String(key).toLowerCase());
    return u ? u.opacity : null;
  }

  _occludes(u, cam, p) {
    if (u.normal) {
      const c = u.center;
      const nx = u.normal.x, nz = u.normal.z;
      const camSide = (cam.x - c.x) * nx + (cam.z - c.z) * nz;   // > 0: além do centro, para fora
      const tgtSide = (p.x - c.x) * nx + (p.z - c.z) * nz;
      const m = CAMERA.wall.margin;
      // câmera fora (ou dentro da espessura / colada na face de dentro) e o alvo dentro do cômodo
      if (camSide > -u.halfThick - m && tgtSide < u.halfThick * 0.5) return segmentHitsBox(cam, p, u.inflated);
      return false;
    }
    // objeto qualquer: raycast contra as malhas
    _dir.subVectors(p, cam);
    const dist = _dir.length();
    if (dist < 1e-3) return false;
    _dir.multiplyScalar(1 / dist);
    _ray.set(cam, _dir);
    _ray.near = 0.05;
    _ray.far = Math.max(0.06, dist - 0.1);
    return _ray.intersectObjects(u.meshes, false).length > 0;
  }

  /**
   * @param {number} dt
   * @param {THREE.Vector3} cam   posição da câmera
   * @param {THREE.Vector3[]} samples   pontos do alvo que precisam ficar visíveis (pés, peito, cabeça)
   */
  update(dt, cam, samples) {
    if (!this.units.length) return;
    const W = CAMERA.wall;
    for (const u of this.units) {
      let hit = false;
      if (this.enabled) {
        for (const s of samples) {
          if (this._occludes(u, cam, s)) { hit = true; break; }
        }
      }
      if (hit) {
        u.hold = W.holdBack;
        u.target = W.minOpacity;
      } else {
        u.hold = Math.max(0, u.hold - dt);
        if (u.hold === 0) u.target = 1;
      }
      const rate = u.target < u.opacity ? W.fadeOutLambda : W.fadeInLambda;
      u.opacity = damp(u.opacity, u.target, rate, dt);
      if (Math.abs(u.opacity - u.target) < 0.01) u.opacity = u.target;
      this._apply(u);
    }
  }

  _apply(u) {
    const op = u.opacity;
    if (op === u.applied) return;
    u.applied = op;
    for (const clone of u.mats.values()) {
      clone.opacity = op;
      clone.depthWrite = op >= 0.999 ? (clone.userData._occOrig?.depthWrite ?? true) : false;
      clone.colorWrite = op > 0.012; // invisível: nem desenha, mas a malha segue projetando sombra
    }
  }
}

/** Segmento a->b cruza a caixa (método das lajes)? Início ou fim dentro da caixa também conta. */
export function segmentHitsBox(a, b, box) {
  let t0 = 0, t1 = 1;
  for (const ax of ['x', 'y', 'z']) {
    const d = b[ax] - a[ax];
    const lo = box.min[ax], hi = box.max[ax];
    if (Math.abs(d) < 1e-9) {
      if (a[ax] < lo || a[ax] > hi) return false;
    } else {
      let ta = (lo - a[ax]) / d;
      let tb = (hi - a[ax]) / d;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return clamp(t0, 0, 1) <= t1;
}
