import * as THREE from 'three';
import { rand } from './util.js';

// Paletas HDR leves (o bloom só pega o que passa de ~1.15).
export const PURPLE_PALETTE = [[1.7, 0.7, 2.6], [1.2, 0.5, 2.2], [2.0, 1.1, 2.6], [0.9, 0.4, 1.7]];
export const GOLD_PALETTE = [[2.4, 2.0, 1.2], [2.6, 1.8, 0.8], [2.2, 2.2, 1.6]];
export const HIT_PALETTE = [[2.4, 2.4, 2.4], [2.0, 1.6, 2.6], [2.4, 1.6, 2.0]];
export const HURT_PALETTE = [[2.6, 1.0, 1.2], [2.4, 1.6, 1.4], [2.2, 0.8, 1.6]];

let _softTex = null;
function softTexture() {
  if (_softTex) return _softTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,0.95)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  _softTex = new THREE.CanvasTexture(c);
  _softTex.colorSpace = THREE.SRGBColorSpace;
  return _softTex;
}

/**
 * Efeitos do combate, sem mexer no Particles.js: fumaça roxa ("poof"), faíscas de acerto,
 * chuvinha dourada que o Sombrito deixa para trás. Usa `game.sparkles`, `game.texts` e `game.scene`
 * (lidos a cada uso: a cena pode trocar quando o mundo muda).
 */
export class CombatFx {
  constructor(game) {
    this.game = game;
    this.puffs = [];    // {sprite, mat, vx, vy, vz, life, max, s0, s1}
    this.drops = [];    // {x, y, z, t, dur, acc}
    this.scene = null;  // cena onde estão os sprites de fumaça (para limpar certo)
  }

  /** Nuvenzinha de fumaça roxa + estrelinhas. */
  poof(x, y, z, { scale = 1, count = 7, sparks = 16 } = {}) {
    const scene = this.game.scene;
    this.scene = scene;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.25 + Math.random() * 0.45) * scale;
      const mat = new THREE.SpriteMaterial({
        map: softTexture(), color: new THREE.Color().setRGB(0.32 + Math.random() * 0.12, 0.1, 0.5 + Math.random() * 0.15),
        transparent: true, depthWrite: false, opacity: 0.85,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.renderOrder = 9;
      const s0 = (0.16 + Math.random() * 0.1) * scale;
      sprite.scale.setScalar(s0);
      sprite.position.set(x + Math.cos(a) * 0.05 * scale, y + Math.random() * 0.08 * scale, z + Math.sin(a) * 0.05 * scale);
      scene.add(sprite);
      const life = 0.5 + Math.random() * 0.3;
      this.puffs.push({
        sprite, mat, vx: Math.cos(a) * sp, vy: 0.2 + Math.random() * 0.35, vz: Math.sin(a) * sp,
        life, max: life, s0, s1: s0 * (2.4 + Math.random() * 0.8),
      });
    }
    this.game.sparkles?.burst(x, y + 0.1 * scale, z, sparks, { speed: 1.5 * scale, life: 0.8, size: 0.07 * scale, gravity: -0.6, palette: PURPLE_PALETTE });
  }

  /** Estrelinhas brancas/lilás no ponto de um acerto. */
  hitSpark(x, y, z, count = 12) {
    this.game.sparkles?.burst(x, y, z, count, { speed: 1.8, life: 0.55, size: 0.07, gravity: -1.2, palette: HIT_PALETTE });
  }

  /** Estrelinhas vermelhas/rosadas quando a Aprendiz leva um golpe. */
  hurtSpark(x, y, z) {
    this.game.sparkles?.burst(x, y, z, 14, { speed: 1.6, life: 0.6, size: 0.075, gravity: -1.0, palette: HURT_PALETTE });
  }

  /** Chuvinha de brilhos dourados que sobe devagar (o "drop" do Sombrito). */
  drop(x, z, y = 0.15) {
    this.drops.push({ x, y, z, t: 0, dur: 0.9, acc: 0 });
    this.game.sparkles?.burst(x, y + 0.1, z, 10, { speed: 0.6, life: 1.2, size: 0.085, gravity: 0.5, palette: GOLD_PALETTE });
  }

  /** Texto flutuante ("!", "Pow!"...) usando o FloatingTexts do jogo. */
  text(str, x, y, z, opts = { scale: 0.55 }) {
    this.game.texts?.spawn(str, x, y, z, opts);
  }

  update(dt) {
    const scene = this.scene ?? this.game.scene;
    for (let i = this.puffs.length - 1; i >= 0; i--) {
      const p = this.puffs[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.sprite.parent?.remove(p.sprite);
        p.mat.dispose();
        this.puffs.splice(i, 1);
        continue;
      }
      const k = 1 - p.life / p.max;
      const damp = Math.exp(-3 * dt);
      p.vx *= damp; p.vz *= damp; p.vy *= damp;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      p.sprite.scale.setScalar(p.s0 + (p.s1 - p.s0) * (1 - (1 - k) * (1 - k)));
      p.mat.opacity = 0.85 * (1 - k * k);
    }
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.t += dt;
      d.acc += dt * 34;
      while (d.acc >= 1) {
        d.acc -= 1;
        const c = GOLD_PALETTE[(Math.random() * GOLD_PALETTE.length) | 0];
        this.game.sparkles?.emit({
          x: d.x + rand(-0.12, 0.12), y: d.y + rand(0, 0.1), z: d.z + rand(-0.12, 0.12),
          vx: rand(-0.12, 0.12), vy: rand(0.25, 0.6), vz: rand(-0.12, 0.12),
          life: rand(0.6, 1.1), size: rand(0.05, 0.085), r: c[0], g: c[1], b: c[2], gravity: 0.1, drag: 1.4,
        });
      }
      if (d.t >= d.dur) this.drops.splice(i, 1);
    }
    void scene;
  }

  clear() {
    for (const p of this.puffs) { p.sprite.parent?.remove(p.sprite); p.mat.dispose(); }
    this.puffs.length = 0;
    this.drops.length = 0;
  }
}
