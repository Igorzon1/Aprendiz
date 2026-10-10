/**
 * Grade de navegação + A* para os gatos (a casa é pequena, então uma grade fina é barata).
 * Constrói a grade a partir dos mesmos colisores que o jogador usa, engordados pelo raio do agente.
 */
export class Nav {
  /**
   * @param {import('./Collision.js').Collision} collision
   * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} bounds
   * @param {{radius?:number,height?:number,cell?:number}} opts
   */
  constructor(collision, bounds, { radius = 0.14, height = 0.3, cell = 0.1 } = {}) {
    this.collision = collision;
    this.radius = radius;
    this.height = height;
    const w = bounds.maxX - bounds.minX;
    const d = bounds.maxZ - bounds.minZ;
    this.cell = Math.max(cell, Math.max(w, d) / 220); // limita o tamanho da grade
    this.minX = bounds.minX;
    this.minZ = bounds.minZ;
    this.nx = Math.max(1, Math.ceil(w / this.cell));
    this.nz = Math.max(1, Math.ceil(d / this.cell));
    this.blocked = new Uint8Array(this.nx * this.nz);
    this.rebuild();
    // buffers do A*
    this._g = new Float32Array(this.nx * this.nz);
    this._from = new Int32Array(this.nx * this.nz);
    this._state = new Uint8Array(this.nx * this.nz); // 0 novo, 1 aberto, 2 fechado
  }

  /** Passa a usar a grade de outro Nav (troca de cenário sem trocar referências). */
  adopt(other) {
    for (const k of ['collision', 'radius', 'height', 'cell', 'minX', 'minZ', 'nx', 'nz', 'blocked', '_g', '_from', '_state']) this[k] = other[k];
  }

  rebuild() {
    for (let iz = 0; iz < this.nz; iz++) {
      for (let ix = 0; ix < this.nx; ix++) {
        const x = this.minX + (ix + 0.5) * this.cell;
        const z = this.minZ + (iz + 0.5) * this.cell;
        this.blocked[iz * this.nx + ix] = this.collision.isFree(x, z, this.radius, this.height) ? 0 : 1;
      }
    }
  }

  _ix(x) { return Math.min(this.nx - 1, Math.max(0, Math.floor((x - this.minX) / this.cell))); }
  _iz(z) { return Math.min(this.nz - 1, Math.max(0, Math.floor((z - this.minZ) / this.cell))); }
  _cx(ix) { return this.minX + (ix + 0.5) * this.cell; }
  _cz(iz) { return this.minZ + (iz + 0.5) * this.cell; }
  _free(ix, iz) { return ix >= 0 && iz >= 0 && ix < this.nx && iz < this.nz && this.blocked[iz * this.nx + ix] === 0; }

  isFree(x, z) { return this._free(this._ix(x), this._iz(z)); }

  /** Ponto livre mais próximo (busca em anéis). Retorna {x,z} ou null. */
  nearestFree(x, z, maxRadius = 2) {
    const cx = this._ix(x), cz = this._iz(z);
    if (this._free(cx, cz)) return { x, z };
    const maxR = Math.ceil(maxRadius / this.cell);
    let best = null, bestD = Infinity;
    for (let r = 1; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          if (!this._free(cx + dx, cz + dz)) continue;
          const px = this._cx(cx + dx), pz = this._cz(cz + dz);
          const d = (px - x) ** 2 + (pz - z) ** 2;
          if (d < bestD) { bestD = d; best = { x: px, z: pz }; }
        }
      }
      if (best) return best; // o primeiro anel com resultado já é o mais próximo (aprox.)
    }
    return null;
  }

  /** Linha de visão na grade. */
  _los(ax, az, bx, bz) {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / (this.cell * 0.5)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.isFree(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  /**
   * Caminho de (ax,az) até (bx,bz) como lista de pontos {x,z} (sem o ponto inicial; o último é
   * o destino, ajustado para o ponto livre mais próximo). Retorna [] se já estiver lá e
   * null se não existir caminho.
   */
  findPath(ax, az, bx, bz) {
    const goal = this.nearestFree(bx, bz, 1.5);
    if (!goal) return null;
    const start = this.nearestFree(ax, az, 0.6);
    if (!start) return [{ x: goal.x, z: goal.z }];
    if (this._los(start.x, start.z, goal.x, goal.z)) return [{ x: goal.x, z: goal.z }];

    const nx = this.nx, nz = this.nz;
    const sIx = this._ix(start.x), sIz = this._iz(start.z);
    const gIx = this._ix(goal.x), gIz = this._iz(goal.z);
    const sIdx = sIz * nx + sIx, gIdx = gIz * nx + gIx;
    if (sIdx === gIdx) return [{ x: goal.x, z: goal.z }];

    const g = this._g, from = this._from, state = this._state;
    state.fill(0);
    // heap binário simples de [f, idx]
    const heap = [];
    const push = (f, idx) => {
      heap.push([f, idx]);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    const h = (ix, iz) => {
      const dx = Math.abs(ix - gIx), dz = Math.abs(iz - gIz);
      return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };

    g[sIdx] = 0; from[sIdx] = -1; state[sIdx] = 1;
    push(h(sIx, sIz), sIdx);
    let found = false;
    while (heap.length) {
      const [, cur] = pop();
      if (state[cur] === 2) continue;
      state[cur] = 2;
      if (cur === gIdx) { found = true; break; }
      const cix = cur % nx, ciz = (cur / nx) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const ix = cix + dx, iz = ciz + dz;
          if (!this._free(ix, iz)) continue;
          // diagonal: não corta quina
          if (dx && dz && (!this._free(cix + dx, ciz) || !this._free(cix, ciz + dz))) continue;
          const ni = iz * nx + ix;
          if (state[ni] === 2) continue;
          const ng = g[cur] + (dx && dz ? Math.SQRT2 : 1);
          if (state[ni] === 0 || ng < g[ni]) {
            g[ni] = ng; from[ni] = cur; state[ni] = 1;
            push(ng + h(ix, iz), ni);
          }
        }
      }
    }
    if (!found) return null;

    // reconstrói e suaviza (string pulling por linha de visão)
    const raw = [];
    for (let i = gIdx; i !== -1; i = from[i]) raw.push({ x: this._cx(i % nx), z: this._cz((i / nx) | 0) });
    raw.reverse();
    raw[0] = { x: start.x, z: start.z };
    raw[raw.length - 1] = { x: goal.x, z: goal.z };
    const out = [];
    let anchor = 0;
    while (anchor < raw.length - 1) {
      let far = anchor + 1;
      for (let j = raw.length - 1; j > anchor + 1; j--) {
        if (this._los(raw[anchor].x, raw[anchor].z, raw[j].x, raw[j].z)) { far = j; break; }
      }
      out.push(raw[far]);
      anchor = far;
    }
    return out;
  }
}
