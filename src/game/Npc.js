import * as THREE from 'three';
import { Animator } from './Animator.js';
import { DIVONICA } from './configWorld.js';
import { Emitter, angleDiff, clamp, dampAngle, yawOf } from './util.js';

/**
 * NPC falante (a Divonica): anda em linha reta até um ponto (com colisão), vira para um alvo, toca clips
 * (Wave, GiveWand, Talk...) e fica em Idle. Mesmo "formato" do Player/Cat para a câmera (pos, yaw, headWorld).
 */
export class Npc extends Emitter {
  constructor({ name, asset, collision, radius = 0.18 }) {
    super();
    this.name = name;
    this.kind = 'npc';
    this.collision = collision;
    this.radius = radius;
    this.root = new THREE.Group();
    this.root.name = name;
    this.model = asset.scene;
    this.root.add(this.model);
    this.model.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.receiveShadow = false; } });
    this.animator = new Animator(this.model, asset.clips, asset.events, { fps: asset.fps });
    this.animator.on('finished', (clip) => this._onFinished(clip));
    this.animator.on('event', (clip, evt) => this.emit('animEvent', clip, evt));
    this.head = this.model.getObjectByName('head') ?? null;

    this.pos = this.root.position;
    this.yaw = 0;
    this.speed = 0;
    this.goal = null;       // {x, z, speed, stop, resolve, t}
    this.face = null;       // {x, z} | null
    this.once = null;       // {name, resolve}
    this.idleClip = 'Idle';
    this.curLoco = null;
    this.root.visible = false;
    this.active = false;
  }

  place(x, z, yaw = this.yaw) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
    this.speed = 0;
    this.goal = null;
    this.once = null;
    this.curLoco = null;
  }

  activate(visible = true) {
    this.active = true;
    this.root.visible = visible;
    this.curLoco = null;
    this.animator.play('Idle', { fade: 0 });
    this.animator.update(0.001);
  }

  setVisible(v) { this.root.visible = v; }

  headWorld(out = new THREE.Vector3()) {
    if (this.head) return this.head.getWorldPosition(out);
    return out.set(this.pos.x, this.pos.y + 0.6, this.pos.z);
  }

  faceTo(x, z) { this.face = x === null ? null : { x, z }; }

  setIdleClip(name) { this.idleClip = name; this.curLoco = null; }

  /** Anda até (x, z). Resolve ao chegar (ou travar / estourar o tempo). */
  walkTo(x, z, { speed = 1.2, stopDist = 0.1 } = {}) {
    if (this.goal) this.goal.resolve();
    return new Promise((resolve) => { this.goal = { x, z, speed, stop: stopDist, resolve, t: 0 }; });
  }

  /** Toca um clip de uma vez; resolve no fim. Cíclicos (Talk) tocam até `setIdleClip`. */
  playClip(name, { fade = 0.18 } = {}) {
    return new Promise((resolve) => {
      if (this.once) this.once.resolve();
      this.once = { name, resolve };
      this.curLoco = null;
      this.animator.play(name, { fade, fallback: ['Idle'] });
    });
  }

  _onFinished(clip) {
    const o = this.once;
    if (o && o.name === clip) {
      this.once = null;
      this.curLoco = null;
      o.resolve();
    }
  }

  update(dt) {
    if (!this.active) return;
    const pos = this.pos;
    let vx = 0, vz = 0, want = 0;
    const g = this.goal;
    if (g && !this.once) {
      g.t += dt;
      const dx = g.x - pos.x, dz = g.z - pos.z, d = Math.hypot(dx, dz);
      if (d <= g.stop || g.t > 20) { this.goal = null; g.resolve(); } else {
        want = g.speed * clamp(0.35 + (d - g.stop) / 0.6, 0.35, 1);
        vx = (dx / d) * want; vz = (dz / d) * want;
      }
    }
    const px = pos.x, pz = pos.z;
    if (want > 0) {
      pos.x += vx * dt; pos.z += vz * dt;
      this.collision.resolve(pos, this.radius, 0.9);
    }
    this.speed += (Math.hypot(pos.x - px, pos.z - pz) / Math.max(dt, 1e-4) - this.speed) * (1 - Math.exp(-14 * dt));

    let target = null;
    if (want > 0.05) target = yawOf(vx, vz);
    else if (this.face) target = yawOf(this.face.x - pos.x, this.face.z - pos.z);
    if (target !== null) this.yaw = dampAngle(this.yaw, target, 10, dt);
    this.root.rotation.y = this.yaw;

    if (!this.once) {
      let clip = this.idleClip;
      let ts = 1;
      if (want > 0.05 || this.speed > 0.2) {
        clip = want > DIVONICA.runSpeed * 0.6 || this.speed > 2.0 ? 'Run' : 'Walk';
        const nominal = clip === 'Run' ? 2.6 : 1.2;
        ts = clamp(Math.max(this.speed, nominal * 0.4) / nominal, 0.6, 1.6);
      }
      if (clip !== this.curLoco) { this.animator.play(clip, { fade: 0.18, timeScale: ts }); this.curLoco = clip; } else if (clip === 'Walk' || clip === 'Run') this.animator.setTimeScale(ts);
    }
    this.animator.update(dt);
  }

  /** Quanto falta para virar para (x, z) (rad). */
  turnError(x, z) { return Math.abs(angleDiff(this.yaw, yawOf(x - this.pos.x, z - this.pos.z))); }
}
