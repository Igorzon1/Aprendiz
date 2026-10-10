import * as THREE from 'three';
import { rand } from './util.js';

let _soft = null;
/** Textura circular macia (branco -> transparente), compartilhada. */
export function softTexture() {
  if (_soft) return _soft;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _soft = new THREE.CanvasTexture(c);
  _soft.colorSpace = THREE.SRGBColorSpace;
  return _soft;
}

export const DUST_COLORS = ['#d8c7a6', '#cbb894', '#e6d9bd'];
export const SHADOW_COLORS = ['#52307a', '#3b2057', '#6a3f95'];

/**
 * Nuvenzinhas de sprite (poeira, fumaça de sombra) com mistura normal. `game.puffs`.
 * `puff(x, y, z, { colors, count, scale, life, rise, spread, opacity })`.
 */
export class Puffs {
  constructor(game) {
    this.game = game;
    this.list = [];
  }

  puff(x, y, z, { colors = DUST_COLORS, count = 6, scale = 1, life = 0.5, rise = 0.25, spread = 0.5, opacity = 0.7, grow = 2.6 } = {}) {
    const scene = this.game.scene;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.3 + Math.random() * 0.7) * spread * scale;
      const mat = new THREE.SpriteMaterial({
        map: softTexture(), color: new THREE.Color(colors[(Math.random() * colors.length) | 0]),
        transparent: true, depthWrite: false, opacity,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.renderOrder = 8;
      const s0 = (0.12 + Math.random() * 0.08) * scale;
      sprite.scale.setScalar(s0);
      sprite.position.set(x + Math.cos(a) * 0.04 * scale, y + Math.random() * 0.05, z + Math.sin(a) * 0.04 * scale);
      scene.add(sprite);
      const l = life * rand(0.7, 1.2);
      this.list.push({ sprite, mat, vx: Math.cos(a) * sp, vy: rise * rand(0.5, 1.2), vz: Math.sin(a) * sp, life: l, max: l, s0, s1: s0 * grow * rand(0.8, 1.2), op: opacity });
    }
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.parent?.remove(p.sprite);
        p.mat.dispose();
        this.list.splice(i, 1);
        continue;
      }
      const k = 1 - p.life / p.max;
      const d = Math.exp(-3.2 * dt);
      p.vx *= d; p.vz *= d; p.vy *= d;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      p.sprite.scale.setScalar(p.s0 + (p.s1 - p.s0) * (1 - (1 - k) * (1 - k)));
      p.mat.opacity = p.op * (1 - k * k);
    }
  }

  clear() {
    for (const p of this.list) { p.sprite.parent?.remove(p.sprite); p.mat.dispose(); }
    this.list.length = 0;
  }
}
