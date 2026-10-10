import * as THREE from 'three';
import { PLAYER } from './config.js';
import { clamp, damp, easeOutBack } from './util.js';

const SHIELD_PALETTE = [[0.7, 1.8, 2.6], [1.1, 1.4, 2.8], [0.5, 2.2, 2.4], [1.6, 1.9, 2.8]];
const TEXT_BLOCK = 'Bloqueou!';

function hexTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 3;
  const R = 22, w = Math.sqrt(3) * R, h = 1.5 * R;
  for (let row = -1; row < 256 / h + 2; row++) {
    for (let col = -1; col < 256 / w + 2; col++) {
      const cx = col * w + (row & 1 ? w / 2 : 0), cy = row * h;
      g.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a);
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
      g.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 1.4);
  return t;
}

/**
 * Escudo mágico da Aprendiz (botão direito / K): calota translúcida e brilhante na frente dela (cone de ~120°),
 * com contorno que solta faíscas; ao bloquear um golpe ela "estala" (clarão + faíscas). System do Game.
 */
export class MagicShield {
  /** @param {import('./Game.js').Game} game */
  constructor(game) {
    this.game = game;
    const B = PLAYER.block;
    this.group = new THREE.Group();
    this.group.name = 'MagicShield';
    this.group.position.set(0, B.height, 0);
    this.group.visible = false;

    const R = B.radius + B.ahead;
    const half = Math.acos(B.coneCos);                       // meia-abertura horizontal (60°)
    const vert = 0.88;                                       // meia-abertura vertical (~50°)
    this.R = R; this.half = half; this.vert = vert;
    const geo = new THREE.SphereGeometry(R, 30, 16, Math.PI / 2 - half, half * 2, Math.PI / 2 - vert, vert * 2);
    this.mat = new THREE.MeshBasicMaterial({
      map: hexTexture(), color: new THREE.Color(0.55, 1.5, 2.4), transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false, toneMapped: false,
    });
    this.dome = new THREE.Mesh(geo, this.mat);
    this.dome.renderOrder = 7;
    // um brilho de contorno: a mesma calota um pouco maior, só com a borda clara (contorno por linhas)
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), new THREE.LineBasicMaterial({
      color: new THREE.Color(1.4, 2.4, 3.0), transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false,
    }));
    edge.renderOrder = 8;
    this.dome.add(edge);
    this.group.add(this.dome);
    game.player.root.add(this.group);

    this.s = 0;              // 0 = fechado, 1 = aberto
    this.flash = 0;
    this.t = 0;
    this._v = new THREE.Vector3();
    game.player.on('blocked', (fx, fz) => this._onBlocked(fx, fz));
  }

  update(dt) {
    const p = this.game.player;
    this.t += dt;
    const want = p.blocking ? 1 : 0;
    this.s = clamp(this.s + (want ? dt * 7 : -dt * 9), 0, 1);
    this.flash = damp(this.flash, 0, 10, dt);
    if (this.s <= 0.001) { this.group.visible = false; return; }
    this.group.visible = true;
    const k = easeOutBack(this.s, 1.6);
    const pulse = 1 + 0.015 * Math.sin(this.t * 7);
    this.group.scale.setScalar(Math.max(0.01, k * pulse * (1 + 0.1 * this.flash)));
    this.mat.opacity = (0.34 + 0.06 * Math.sin(this.t * 5) + 0.5 * this.flash) * this.s;
    this.mat.map.offset.set(this.t * 0.03, this.t * 0.05);
    if (this.s > 0.7) this._rimSparkles(dt);
  }

  /** Faíscas que correm pela borda da calota. */
  _rimSparkles(dt) {
    const sp = this.game.sparkles;
    this._acc = (this._acc ?? 0) + dt * 22;
    while (this._acc >= 1) {
      this._acc -= 1;
      const u = Math.random();
      let az, el;
      if (u < 0.5) { az = (Math.random() * 2 - 1) * this.half; el = (Math.random() < 0.5 ? -1 : 1) * this.vert; }
      else { az = (Math.random() < 0.5 ? -1 : 1) * this.half; el = (Math.random() * 2 - 1) * this.vert; }
      const ce = Math.cos(el);
      this._v.set(this.R * Math.sin(az) * ce, this.R * Math.sin(el), this.R * Math.cos(az) * ce);
      this.group.localToWorld(this._v);
      const c = SHIELD_PALETTE[(Math.random() * SHIELD_PALETTE.length) | 0];
      sp.emit({ x: this._v.x, y: this._v.y, z: this._v.z, vx: (Math.random() - 0.5) * 0.2, vy: 0.15 + Math.random() * 0.25, vz: (Math.random() - 0.5) * 0.2, life: 0.4 + Math.random() * 0.3, size: 0.035 + Math.random() * 0.03, r: c[0], g: c[1], b: c[2], gravity: 0, drag: 1.5 });
    }
  }

  /** Bloqueou um golpe vindo de (fx, fz): clarão e faíscas no ponto da calota voltado para o atacante. */
  _onBlocked(fx, fz) {
    const p = this.game.player;
    this.flash = 1;
    let dx = fx - p.pos.x, dz = fz - p.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const R = this.R;
    const x = p.pos.x + dx * R, z = p.pos.z + dz * R, y = p.pos.y + PLAYER.block.height;
    this.game.sparkles.burst(x, y, z, 18, { speed: 1.8, life: 0.5, size: 0.07, gravity: -0.5, palette: SHIELD_PALETTE });
    this.game.texts.spawn(TEXT_BLOCK, x, y + 0.3, z, { scale: 0.5 });
  }

  dispose() {
    this.group.parent?.remove(this.group);
  }
}
