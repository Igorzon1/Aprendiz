import * as THREE from 'three';

/**
 * Colisão círculo-contra-AABB no plano XZ, a partir das caixas `COL_*` da casa.
 * Cada caixa guarda também a altura (minY/maxY): um personagem baixinho (gato) passa por baixo
 * de coisas altas (prateleira suspensa), e tapetes finos não bloqueiam ninguém.
 */
export class Collision {
  constructor() {
    /** @type {{name:string,minX:number,maxX:number,minY:number,maxY:number,minZ:number,maxZ:number}[]} */
    this.boxes = [];
    this.bounds = null; // {minX,maxX,minZ,maxZ}: rede de segurança (a frente da casa é aberta)
  }

  addBox(box3, name = '') {
    this.boxes.push({
      name,
      minX: box3.min.x, maxX: box3.max.x,
      minY: box3.min.y, maxY: box3.max.y,
      minZ: box3.min.z, maxZ: box3.max.z,
    });
  }

  /** Remove (no lugar: o array é compartilhado) todas as caixas com esse nome. Retorna quantas saíram. */
  removeBox(name) {
    let n = 0;
    for (let i = this.boxes.length - 1; i >= 0; i--) if (this.boxes[i].name === name) { this.boxes.splice(i, 1); n++; }
    return n;
  }

  hasBox(name) { return this.boxes.some((b) => b.name === name); }

  /** Passa a usar as caixas/limites de outra Collision (troca de cenário sem trocar referências). */
  adopt(other) {
    this.boxes = other.boxes;
    this.bounds = other.bounds;
  }

  setBounds(minX, maxX, minZ, maxZ) { this.bounds = { minX, maxX, minZ, maxZ }; }

  /** A caixa conta para um personagem de altura `height`? */
  _blocks(b, height) { return b.maxY > 0.04 && b.minY < height; }

  /**
   * Empurra o círculo (p.x, p.z, r) para fora das caixas. Retorna true se mexeu na posição.
   * Funciona como "deslizar na parede": só remove a componente que penetra.
   */
  resolve(p, r, height = 1) {
    let moved = false;
    for (let pass = 0; pass < 4; pass++) {
      let any = false;
      for (const b of this.boxes) {
        if (!this._blocks(b, height)) continue;
        const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
        let dx = p.x - cx;
        let dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2);
          p.x = cx + (dx / d) * r;
          p.z = cz + (dz / d) * r;
        } else {
          // centro dentro da caixa: sai pelo lado mais próximo
          const l = p.x - b.minX, rr = b.maxX - p.x, t = p.z - b.minZ, bt = b.maxZ - p.z;
          const m = Math.min(l, rr, t, bt);
          if (m === l) p.x = b.minX - r;
          else if (m === rr) p.x = b.maxX + r;
          else if (m === t) p.z = b.minZ - r;
          else p.z = b.maxZ + r;
        }
        any = true;
        moved = true;
      }
      if (!any) break;
    }
    if (this.bounds) {
      const k = this.bounds;
      const x = Math.min(Math.max(p.x, k.minX + r), k.maxX - r);
      const z = Math.min(Math.max(p.z, k.minZ + r), k.maxZ - r);
      if (x !== p.x || z !== p.z) { p.x = x; p.z = z; moved = true; }
    }
    return moved;
  }

  /** Move `p` por (dx, dz) e resolve colisões. */
  move(p, dx, dz, r, height = 1) {
    p.x += dx;
    p.z += dz;
    this.resolve(p, r, height);
  }

  isFree(x, z, r, height = 1) {
    for (const b of this.boxes) {
      if (!this._blocks(b, height)) continue;
      const cx = Math.max(b.minX, Math.min(x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
      const dx = x - cx, dz = z - cz;
      if (dx * dx + dz * dz < r * r) return false;
    }
    if (this.bounds) {
      const k = this.bounds;
      if (x < k.minX + r || x > k.maxX - r || z < k.minZ + r || z > k.maxZ - r) return false;
    }
    return true;
  }

  /** O segmento a->b (com raio r) está livre? Amostrado a cada ~r/2. */
  segmentFree(ax, az, bx, bz, r, height = 1) {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / Math.max(0.05, r * 0.6)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.isFree(ax + (bx - ax) * t, az + (bz - az) * t, r, height)) return false;
    }
    return true;
  }

  /** Ponto 3D dentro de alguma caixa (com folga `pad`)? Usado pelas bolas de magia. */
  pointBlocked(x, y, z, pad = 0) {
    for (const b of this.boxes) {
      if (b.maxY < 0.04) continue;
      if (x > b.minX - pad && x < b.maxX + pad && y > b.minY - pad && y < b.maxY + pad && z > b.minZ - pad && z < b.maxZ + pad) return true;
    }
    if (this.bounds) {
      const k = this.bounds;
      if (x < k.minX || x > k.maxX || z < k.minZ || z > k.maxZ) return true;
    }
    return false;
  }
}

/** Box3 de um objeto em coordenadas de mundo (atualiza as matrizes antes). */
export function worldBox(object) {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object);
}
