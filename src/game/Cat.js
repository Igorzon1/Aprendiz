import * as THREE from 'three';
import { Animator } from './Animator.js';
import { CAT } from './config.js';
import { Emitter, angleDiff, clamp, dampAngle, smoothstep, yawOf } from './util.js';

/**
 * O "corpo" de um gato: posição, movimento suave (aceleração, virada gradual), caminho na grade
 * de navegação, colisão com a casa, separação de outros seres e animação casada com a velocidade.
 * As decisões (o que fazer) ficam no CatBrain; aqui só se executa.
 */
export class Cat extends Emitter {
  constructor({ name, asset, collision, nav }) {
    super();
    this.name = name;
    this.collision = collision;
    this.nav = nav;

    this.root = new THREE.Group();
    this.root.name = name;
    this.model = asset.scene;
    this.root.add(this.model);
    this.speeds = { walk: asset.speeds?.Walk ?? CAT.walkSpeed, run: asset.speeds?.Run ?? CAT.runSpeed };
    this.animator = new Animator(this.model, asset.clips, asset.events, { fps: asset.fps, rig: asset.rig ?? null });
    this.animator.on('event', (clip, evt) => this._onEvent(clip, evt));
    this.animator.on('finished', (clip) => this._onFinished(clip));

    this.pos = this.root.position;
    this.yaw = 0;
    this.vx = 0;
    this.vz = 0;
    this.speed = 0;

    this.active = false;     // aparece no mundo e é atualizado
    this.scripted = false;   // controlado pela história: o cérebro fica quieto
    this.ghost = false;      // movimento roteirizado em linha reta, sem colisão (portinhola)
    this.posture = 'stand';  // 'stand' | 'sitting'
    this.idleClip = 'Idle';

    this.path = [];
    this.moveSpeed = 0;      // velocidade pedida pelo cérebro (m/s)
    this.stopDist = 0.06;
    this.arrived = true;
    this.stuck = false;
    this.stuckT = 0;
    this.neighbors = () => [];

    this.face = null;        // {type:'point',x,z} | {type:'yaw',yaw}
    this.once = null;        // {name, cb}
    this.leap = null;        // {sx,sz,ex,ez,t,dur}
    this.pendingPounce = null;
    this.pounceHold = null;  // {t, frozen}: congela o Pounce agachado (brincadeira) até releasePounce()
    this.wiggle = 0;         // balanço do traseiro (rad) somado ao yaw
    this.curLoco = null;
    this.scriptUntil = 0;

    this.root.visible = false;
  }

  // ----- ciclo de vida -------------------------------------------------------------------------
  place(x, z, yaw = this.yaw) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
    this.vx = this.vz = this.speed = 0;
    this.path = [];
    this.arrived = true;
  }

  /** Teletransporte (troca de cenário): zera tudo o que estava em andamento. */
  teleport(x, z, yaw = this.yaw) {
    this.once = null;
    this.leap = null;
    this.pendingPounce = null;
    this.pounceHold = null;
    this.wiggle = 0;
    this.ghost = false;
    this.posture = 'stand';
    this.idleClip = 'Idle';
    this.curLoco = null;
    this.face = null;
    this.stuck = false;
    this.stuckT = 0;
    this.place(x, z, yaw);
    this.moveSpeed = 0;
    this.pos.y = 0;
    this.animator.setTimeScale(1);
    if (this.active) { this.animator.play('Idle', { fade: 0 }); this.animator.update(0.001); }
    this.brain?.reset?.();
  }

  activate(visible = true) {
    this.active = true;
    this.root.visible = visible;
    this.curLoco = null;
    this.animator.play('Idle', { fade: 0 });
    this.animator.update(0.001);
  }

  setVisible(v) { this.root.visible = v; }

  // ----- comandos (usados pelo cérebro e pela história) -----------------------------------------
  /**
   * Anda até (x,z). Usa o A* da grade de navegação, a menos que `ghost` (linha reta sem colisão).
   * @param {{speed?:number, stopDist?:number, ghost?:boolean}} o
   */
  walkTo(x, z, { speed = this.speeds.walk, stopDist = 0.06, ghost = false } = {}) {
    this.ghost = ghost;
    this.moveSpeed = speed;
    this.stopDist = Math.max(stopDist, 0.04);
    this.stuck = false;
    this.stuckT = 0;
    this.goal = { x, z };
    if (ghost) {
      this.path = [{ x, z }];
    } else {
      const p = this.nav.findPath(this.pos.x, this.pos.z, x, z);
      this.path = p ? p : [];
    }
    this.arrived = this.path.length === 0;
    this.cancelOnce();
  }

  setSpeed(speed) { this.moveSpeed = speed; }

  stopMoving() {
    this.path = [];
    this.moveSpeed = 0;
    this.arrived = true;
    this.ghost = false;
  }

  faceTo(x, z) { this.face = x === null ? null : { type: 'point', x, z }; }
  faceYaw(yaw) { this.face = yaw === null ? null : { type: 'yaw', yaw }; }

  setIdleClip(name) { this.idleClip = name; }

  /** Toca um clip de uma vez; `cb` quando terminar (clips ausentes simulam a duração). */
  playOnce(name, cb = null, { fade = 0.2 } = {}) {
    this.once = { name, cb };
    this.curLoco = null;
    this.animator.play(name, { fade });
  }

  cancelOnce() {
    this.once = null;
    if (this.pounceHold) { this.pounceHold = null; this.wiggle = 0; this.animator.setTimeScale(1); }
  }

  /** Solta o bote que estava agachado/congelado (hold). */
  releasePounce() {
    if (!this.pounceHold) return;
    this.pounceHold = null;
    this.wiggle = 0;
    this.animator.setTimeScale(1);
  }

  /** Salto do Pounce: entre os eventos `leap` e `land` o gato anda `dist` metros para frente. */
  pounce(dist, cb, { holdAtFrame = null } = {}) {
    // encurta até o ponto de pouso ficar livre
    const dx = Math.sin(this.yaw), dz = Math.cos(this.yaw);
    let d = dist;
    while (d > 0.1 && !this.collision.isFree(this.pos.x + dx * d, this.pos.z + dz * d, CAT.radius + 0.02, CAT.height)) d -= 0.1;
    this.pendingPounce = { dist: Math.max(0, d), dx, dz };
    this.stopMoving();
    this.pounceHold = holdAtFrame === null ? null : { t: holdAtFrame / 30, frozen: false, clock: 0 };
    this.playOnce('Pounce', () => { this.leap = null; this.pos.y = 0; this.pounceHold = null; this.wiggle = 0; cb?.(); });
  }

  /** Toca um clip roteirizado (história). Cíclicos ficam tocando até `ms`. */
  playScripted(name, { ms = 0 } = {}) {
    const loops = name === 'Idle' || name === 'Walk' || name === 'Run' || name === 'Sit_Idle' || name === 'Purr' || name.endsWith('_Loop');
    if (loops) {
      this.once = null;
      this.curLoco = null;
      this.idleClip = name;
      this.scriptUntil = ms ? performance.now() + ms : 0;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.playOnce(name, resolve));
  }

  // ----- eventos de animação -------------------------------------------------------------------
  _onEvent(clip, evt) {
    if (clip === 'Pounce' && this.pendingPounce) {
      if (evt === 'leap') {
        const p = this.pendingPounce;
        const t0 = this.animator.eventTime('Pounce', 'leap') ?? 0.27;
        const t1 = this.animator.eventTime('Pounce', 'land') ?? t0 + 0.4;
        this.leap = { sx: this.pos.x, sz: this.pos.z, ex: this.pos.x + p.dx * p.dist, ez: this.pos.z + p.dz * p.dist, t: 0, dur: Math.max(0.12, t1 - t0) };
      } else if (evt === 'land' && this.leap) {
        this.pos.x = this.leap.ex; this.pos.z = this.leap.ez; this.pos.y = 0;
        this.leap = null;
      }
    }
  }

  _onFinished(clip) {
    const o = this.once;
    if (o && o.name === clip) {
      this.once = null;
      this.curLoco = null;
      o.cb?.();
    }
  }

  // ----- atualização ---------------------------------------------------------------------------
  update(dt) {
    if (!this.active) return;
    const pos = this.pos;

    // Pulo (Pounce): posição guiada pelo clip
    if (this.leap) {
      const l = this.leap;
      l.t += dt;
      const s = smoothstep(l.t / l.dur);
      pos.x = l.sx + (l.ex - l.sx) * s;
      pos.z = l.sz + (l.ez - l.sz) * s;
      pos.y = Math.sin(Math.PI * clamp(l.t / l.dur, 0, 1)) * 0.1;
      this.vx = this.vz = 0;
    }

    // --- velocidade desejada
    let wantVx = 0, wantVz = 0, wantSpeed = 0;
    const walking = !this.once && !this.leap && this.path.length > 0;
    if (walking) {
      const wp = this.path[0];
      const dx = wp.x - pos.x, dz = wp.z - pos.z;
      const d = Math.hypot(dx, dz);
      const last = this.path.length === 1;
      if (d <= (last ? this.stopDist : 0.09)) {
        this.path.shift();
        if (!this.path.length) { this.arrived = true; this.emit('arrived'); }
      } else {
        wantSpeed = this.moveSpeed;
        if (last) wantSpeed *= clamp(0.3 + (d - this.stopDist) / 0.5, 0.3, 1); // freia ao chegar
        // curva fechada: reduz a velocidade até o corpo alinhar (menos "patinar de lado")
        const turn = Math.abs(angleDiff(this.yaw, yawOf(dx, dz)));
        wantSpeed *= clamp(1.15 - turn / 1.6, 0.2, 1);
        wantVx = (dx / d) * wantSpeed;
        wantVz = (dz / d) * wantSpeed;
      }
    }

    // --- separação suave (cedem espaço ao verem alguém perto)
    if (!this.ghost && !this.leap) {
      for (const n of this.neighbors()) {
        const dx = pos.x - n.pos.x, dz = pos.z - n.pos.z;
        const d = Math.hypot(dx, dz) || 1e-4;
        const range = n.isPlayer ? 0.85 : 0.7;
        if (d < range) {
          const push = ((range - d) / range) * (n.isPlayer ? 1.3 : 0.7);
          wantVx += (dx / d) * push;
          wantVz += (dz / d) * push;
        }
      }
    }

    // --- suavização
    if (!this.leap) {
      const dvx = wantVx - this.vx, dvz = wantVz - this.vz;
      const dl = Math.hypot(dvx, dvz);
      if (dl > 1e-5) {
        const rate = (Math.hypot(wantVx, wantVz) > Math.hypot(this.vx, this.vz) ? CAT.accel : CAT.decel) * dt;
        const k = Math.min(1, rate / dl);
        this.vx += dvx * k;
        this.vz += dvz * k;
      }
    }

    // --- integração + colisão
    const px = pos.x, pz = pos.z;
    if (!this.leap && Math.abs(this.vx) + Math.abs(this.vz) > 1e-4) {
      pos.x += this.vx * dt;
      pos.z += this.vz * dt;
    }
    if (!this.ghost) this.collision.resolve(pos, CAT.radius, CAT.height);
    this.enforceSeparation();
    const real = Math.hypot(pos.x - px, pos.z - pz) / Math.max(dt, 1e-4);
    this.speed += (real - this.speed) * (1 - Math.exp(-18 * dt));

    // --- travou? (grudou num canto) -> avisa o cérebro
    if (walking && wantSpeed > 0.2 && this.speed < wantSpeed * 0.2 && !this.ghost) {
      this.stuckT += dt;
      if (this.stuckT > 1.1) { this.stuck = true; this.path = []; this.arrived = true; this.emit('stuck'); }
    } else {
      this.stuckT = Math.max(0, this.stuckT - dt * 2);
    }

    // --- direção do corpo
    let targetYaw = null;
    if (Math.hypot(this.vx, this.vz) > 0.09 && !this.leap) targetYaw = yawOf(this.vx, this.vz);
    else if (!this.leap && this.face) {
      targetYaw = this.face.type === 'yaw' ? this.face.yaw : yawOf(this.face.x - pos.x, this.face.z - pos.z);
    }
    if (targetYaw !== null) this.yaw = dampAngle(this.yaw, targetYaw, CAT.turnLambda * (this.moveSpeed > 1.5 ? 1.4 : 1), dt);
    // --- agachado esperando o bote: balança o traseiro
    const hold = this.pounceHold;
    if (hold && hold.frozen) {
      hold.clock += dt;
      this.wiggle = Math.sin(hold.clock * Math.PI * 2 * CAT.play.wiggleHz) * CAT.play.wiggleAmp;
    }
    this.root.rotation.y = this.yaw + this.wiggle;

    // --- animação
    this._updateAnimation();
    this.animator.update(dt);
    if (hold && !hold.frozen && this.once?.name === 'Pounce' && this.animator.time >= hold.t) {
      hold.frozen = true;
      this.animator.setTimeScale(0);
    }
    if (this.animator.rig) this.animator.rig.speed = this.speed;
  }

  /** Distâncias mínimas duras (gato-gato e gato-Aprendiz); é o último recurso, o resto é steering. */
  enforceSeparation() {
    if (this.ghost) return;
    for (const n of this.neighbors()) {
      const dx = this.pos.x - n.pos.x, dz = this.pos.z - n.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < CAT.minDist) {
        // contra a Aprendiz o gato cede tudo; contra outro gato, cada um cede metade
        const share = n.isPlayer ? 1 : 0.5;
        const push = (CAT.minDist - d) * share;
        const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
        this.pos.x += nx * push;
        this.pos.z += nz * push;
        this.collision.resolve(this.pos, CAT.radius, CAT.height);
      }
    }
  }

  _updateAnimation() {
    if (this.once || this.leap) return;
    const moving = this.path.length > 0 && this.moveSpeed > 0 || this.speed > 0.12;
    if (moving) {
      const commanded = this.moveSpeed > 0 ? this.moveSpeed : this.speed;
      const clip = commanded > CAT.runThreshold ? 'Run' : 'Walk';
      const nominal = clip === 'Run' ? this.speeds.run : this.speeds.walk;
      const ts = clamp(Math.max(this.speed, nominal * 0.35) / nominal, 0.5, 1.8);
      if (this.curLoco !== clip) {
        const sync = this.curLoco === 'Walk' || this.curLoco === 'Run';
        this.animator.play(clip, { fade: 0.18, timeScale: ts, syncPhase: sync });
        this.curLoco = clip;
      } else {
        this.animator.setTimeScale(ts);
      }
    } else {
      if (this.curLoco !== this.idleClip) {
        this.animator.play(this.idleClip, { fade: 0.22 });
        this.curLoco = this.idleClip;
      }
    }
  }

  distTo(x, z) { return Math.hypot(this.pos.x - x, this.pos.z - z); }
}
