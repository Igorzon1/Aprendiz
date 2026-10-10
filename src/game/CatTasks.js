import * as THREE from 'three';
import { CAT } from './config.js';
import { rand } from './util.js';

/**
 * Tarefas pequenas e componíveis que o CatBrain encadeia.
 * Contrato: start(brain), update(dt, brain), abort(brain); `done` vira true ao terminar.
 * `needsStanding` = precisa que o gato esteja em pé (senão o cérebro faz um StandUp antes).
 */
export class Task {
  constructor() { this.done = false; this.needsStanding = true; }
  start() {}
  update() {}
  abort() {}
}

/** Fica parado com um clip cíclico (Idle/Purr/Sit_Idle) por `time` s, olhando em volta. */
export class IdleTask extends Task {
  constructor(clip = 'Idle', time = 3, { look = false, faceTarget = null } = {}) {
    super();
    this.clip = clip;
    this.time = time;
    this.look = look;
    this.faceTarget = faceTarget; // () => {x,z}
    this.needsStanding = clip !== 'Sit_Idle';
  }

  start(b) {
    b.cat.stopMoving();
    b.cat.setIdleClip(this.clip);
    this.t = this.time;
    this.lookT = rand(0.4, 1.4);
    if (this.faceTarget) { const p = this.faceTarget(); b.cat.faceTo(p.x, p.z); }
  }

  update(dt, b) {
    this.t -= dt;
    if (this.look && !this.faceTarget) {
      this.lookT -= dt;
      if (this.lookT <= 0) {
        this.lookT = rand(1.1, 2.6);
        // às vezes olha para a Aprendiz, às vezes para um lado qualquer
        if (Math.random() < 0.35) b.cat.faceTo(b.player.pos.x, b.player.pos.z);
        else b.cat.faceYaw(b.cat.yaw + rand(-2.2, 2.2));
      }
    }
    if (this.t <= 0) this.done = true;
  }

  abort(b) { b.cat.faceTo(null); b.cat.setIdleClip('Idle'); }
}

/** Toca um clip de uma vez (Groom, Stretch, Meow...) `times` vezes. */
export class OnceTask extends Task {
  constructor(clip, { times = 1, faceTarget = null } = {}) {
    super();
    this.clip = clip;
    this.times = times;
    this.faceTarget = faceTarget;
  }

  start(b) {
    this.n = 0;
    b.cat.stopMoving();
    if (this.faceTarget) { const p = this.faceTarget(); b.cat.faceTo(p.x, p.z); }
    this._play(b);
  }

  _play(b) {
    b.cat.playOnce(this.clip, () => {
      if (++this.n >= this.times) this.done = true;
      else this._play(b);
    });
  }

  abort(b) { b.cat.cancelOnce(); b.cat.faceTo(null); }
}

/** Vira para um ponto (que pode se mover) por `time` s. Pode ser feito sentado. */
export class FaceTask extends Task {
  constructor(getPoint, time = 1.2) {
    super();
    this.getPoint = getPoint;
    this.time = time;
    this.needsStanding = false;
  }
  start(b) { this.t = this.time; const p = this.getPoint(); b.cat.faceTo(p.x, p.z); }
  update(dt, b) {
    this.t -= dt;
    const p = this.getPoint();
    b.cat.faceTo(p.x, p.z);
    if (this.t <= 0) this.done = true;
  }
  abort(b) { b.cat.faceTo(null); }
}

/** SitDown -> Sit_Idle (por `time` s ou até `until()`) -> StandUp. */
export class SitTask extends Task {
  constructor({ time = 5, until = null, faceTarget = null, standUp = true } = {}) {
    super();
    this.time = time;
    this.until = until;
    this.faceTarget = faceTarget;
    this.standUp = standUp;
    this.needsStanding = false;
  }

  start(b) {
    this.phase = 'down';
    this.t = this.time;
    b.cat.stopMoving();
    if (this.faceTarget) { const p = this.faceTarget(); b.cat.faceTo(p.x, p.z); }
    if (b.cat.posture === 'sitting') { this._hold(b); return; }
    b.cat.posture = 'sitting';
    b.cat.playOnce('SitDown', () => this._hold(b));
  }

  _hold(b) {
    this.phase = 'hold';
    b.cat.setIdleClip('Sit_Idle');
  }

  update(dt, b) {
    if (this.faceTarget && this.phase !== 'up') { const p = this.faceTarget(); b.cat.faceTo(p.x, p.z); }
    if (this.phase === 'hold') {
      this.t -= dt;
      const stop = this.until ? this.until() : this.t <= 0;
      if (stop) {
        if (!this.standUp) { this.done = true; return; }
        this.phase = 'up';
        b.cat.faceTo(null);
        b.cat.playOnce('StandUp', () => { b.cat.posture = 'stand'; b.cat.setIdleClip('Idle'); this.done = true; });
      }
    }
  }

  abort(b) { b.cat.cancelOnce(); }
}

/** Levanta (se estiver sentado). */
export class StandUpTask extends Task {
  constructor() { super(); this.needsStanding = false; }
  start(b) {
    if (b.cat.posture === 'stand') { this.done = true; return; }
    b.cat.stopMoving();
    b.cat.playOnce('StandUp', () => { b.cat.posture = 'stand'; b.cat.setIdleClip('Idle'); this.done = true; });
  }
  abort(b) { b.cat.cancelOnce(); b.cat.posture = 'stand'; b.cat.setIdleClip('Idle'); }
}

/**
 * Anda até um alvo (fixo ou função, reavaliada a cada `retarget` s). `speed` pode ser função.
 * Termina ao chegar, travar, estourar o tempo, ou quando `stopWhen()` for verdadeiro.
 */
export class MoveTask extends Task {
  constructor(target, { speed = 1, stopDist = 0.08, retarget = 0, timeout = 14, stopWhen = null } = {}) {
    super();
    this.target = target;
    this.speed = speed;
    this.stopDist = stopDist;
    this.retarget = retarget;
    this.timeout = timeout;
    this.stopWhen = stopWhen;
  }

  _goal() { return typeof this.target === 'function' ? this.target() : this.target; }
  _speed() { return typeof this.speed === 'function' ? this.speed() : this.speed; }

  start(b) {
    this.t = 0;
    this.sinceRetarget = 0;
    this.goal = this._goal();
    if (!this.goal) { this.done = true; return; }
    b.cat.faceTo(null);
    b.cat.walkTo(this.goal.x, this.goal.z, { speed: this._speed(), stopDist: this.stopDist });
    if (b.cat.arrived) this.done = true;
  }

  update(dt, b) {
    this.t += dt;
    this.sinceRetarget += dt;
    const cat = b.cat;
    if (this.retarget > 0 && this.sinceRetarget >= this.retarget) {
      this.sinceRetarget = 0;
      const g = this._goal();
      if (g && Math.hypot(g.x - this.goal.x, g.z - this.goal.z) > 0.3) {
        this.goal = g;
        cat.walkTo(g.x, g.z, { speed: this._speed(), stopDist: this.stopDist });
      }
    }
    if (cat.moveSpeed > 0) cat.setSpeed(this._speed());
    if (cat.arrived || cat.stuck || this.t > this.timeout || (this.stopWhen && this.stopWhen())) this.done = true;
  }

  abort(b) { b.cat.stopMoving(); }
}

/** Gira na direção do alvo e salta (Pounce) `dist` metros. */
export class PounceTask extends Task {
  constructor(x, z, dist) { super(); this.x = x; this.z = z; this.dist = dist; }
  start(b) {
    this.t = 0;
    this.leaping = false;
    b.cat.stopMoving();
    b.cat.faceTo(this.x, this.z);
  }
  update(dt, b) {
    this.t += dt;
    if (this.leaping) return;
    const want = Math.atan2(this.x - b.cat.pos.x, this.z - b.cat.pos.z);
    let d = want - b.cat.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    if (Math.abs(d) < 0.25 || this.t > 1.0) {
      this.leaping = true;
      b.cat.faceTo(null);
      b.cat.pounce(this.dist, () => { this.done = true; });
    }
  }
  abort(b) { b.cat.cancelOnce(); b.cat.faceTo(null); b.cat.leap = null; b.cat.pos.y = 0; }
}

/** Executa tarefas em sequência. */
export class SeqTask extends Task {
  constructor(tasks) {
    super();
    this.tasks = tasks.filter(Boolean);
    this.needsStanding = this.tasks.length ? this.tasks[0].needsStanding : false;
  }
  start(b) { this.i = -1; this._next(b); }
  _next(b) {
    this.i++;
    if (this.i >= this.tasks.length) { this.done = true; return; }
    this.cur = this.tasks[this.i];
    this.cur.start(b);
  }
  update(dt, b) {
    if (this.done || !this.cur) return;
    this.cur.update(dt, b);
    if (this.cur.done) this._next(b);
  }
  abort(b) { if (this.cur && !this.cur.done) this.cur.abort(b); }
}


/**
 * Brincadeira com o brinquedo / brilho do AFK: persegue o ponto em movimento, agacha balançando o traseiro,
 * dá o bote (Pounce) e volta. `getTarget()` devolve um Vector3 (osso no mundo) ou null quando a brincadeira acaba.
 * `opts`: { delay, speed, runSpeed, crouch:[min,max], pounceGap, flopChance }
 */
export class PlayTask extends Task {
  constructor(getTarget, opts = {}) {
    super();
    this.getTarget = getTarget;
    this.o = { delay: 0.2, speed: 1.1, runSpeed: 2.2, crouch: [0.5, 0.9], pounceGap: 0.9, flopChance: 0, ...opts };
    this.needsStanding = true;
    this.isPlay = true;
  }

  start(b) {
    this.phase = 'watch';
    this.t = 0;
    this.lost = 0;
    this.gap = this.o.pounceGap * 0.5;
    this.retarget = 0;
    this.prev = null;
    this.vel = new THREE.Vector3();
    this.crouchLeft = 0;
    this.rec = 0;
    b.cat.stopMoving();
  }

  _lead(tgt, dt) {
    // velocidade do alvo (suavizada) para antecipar o movimento
    if (this.prev && dt > 0) this.vel.lerp(_v1.copy(tgt).sub(this.prev).divideScalar(dt), Math.min(1, dt * 8));
    this.prev = (this.prev ?? new THREE.Vector3()).copy(tgt);
    const lead = _v2.copy(this.vel).multiplyScalar(CAT.play.lead);
    if (lead.length() > CAT.play.leadMax) lead.setLength(CAT.play.leadMax);
    return lead;
  }

  /** Mantém o gato a `playerClear` m da Aprendiz. */
  _clear(b, x, z) {
    const p = b.player.pos;
    let dx = x - p.x, dz = z - p.z;
    const d = Math.hypot(dx, dz);
    if (d < CAT.play.playerClear) {
      if (d < 1e-3) { dx = Math.sin(b.player.yaw); dz = Math.cos(b.player.yaw); } else { dx /= d; dz /= d; }
      x = p.x + dx * CAT.play.playerClear;
      z = p.z + dz * CAT.play.playerClear;
    }
    return { x, z };
  }

  update(dt, b) {
    const cat = b.cat;
    const tgt = this.getTarget();
    this.t += dt;
    this.gap -= dt;
    if (!tgt) {
      // a brincadeira acabou: fica procurando o brinquedo por um instante
      this.lost += dt;
      if (this.phase === 'crouch') { cat.releasePounce(); this.phase = 'leap'; }
      if (this.lost > CAT.play.lingerAfterToy && this.phase !== 'leap') this.done = true;
      return;
    }
    this.lost = 0;
    const lead = this._lead(tgt, dt);
    const gx = tgt.x + lead.x, gz = tgt.z + lead.z;
    const dTarget = cat.distTo(tgt.x, tgt.z);

    switch (this.phase) {
      case 'watch': {       // repara no brinquedo (a Petico demora mais)
        cat.faceTo(tgt.x, tgt.z);
        if (this.t >= this.o.delay) { this.phase = 'chase'; cat.faceTo(null); }
        break;
      }
      case 'chase': {
        this.retarget -= dt;
        const g = this._clear(b, gx, gz);
        if (dTarget < 0.62 && this.gap <= 0 && cat.distTo(g.x, g.z) < 0.7) {
          this.phase = 'crouch';
          this.crouchLeft = rand(this.o.crouch[0], this.o.crouch[1]);
          cat.stopMoving();
          cat.faceTo(tgt.x, tgt.z);
          // o salto cobre a distância até o alvo (no máximo 0.65 m)
          cat.pounce(Math.min(0.65, Math.max(0.3, dTarget)), () => { this.phase = 'recover'; this.rec = rand(0.3, 0.7); cat.faceTo(null); },
            { holdAtFrame: CAT.play.crouchFrame });
          break;
        }
        if (this.retarget <= 0 || cat.arrived) {
          this.retarget = 0.2;
          cat.walkTo(g.x, g.z, { speed: dTarget > 2.2 ? this.o.runSpeed : this.o.speed, stopDist: 0.12 });
        } else if (cat.moveSpeed > 0) {
          cat.setSpeed(dTarget > 2.2 ? this.o.runSpeed : this.o.speed);
        }
        break;
      }
      case 'crouch': {
        cat.faceTo(tgt.x, tgt.z);
        this.crouchLeft -= dt;
        if (this.crouchLeft <= 0 && cat.pounceHold?.frozen) {
          cat.releasePounce();
          this.phase = 'leap';
        }
        break;
      }
      case 'leap':
        break;               // espera o clip terminar (callback do pounce)
      case 'recover': {
        this.rec -= dt;
        if (this.rec <= 0) {
          this.gap = this.o.pounceGap * rand(0.9, 1.5);
          if (this.o.flopChance && Math.random() < this.o.flopChance) {
            this.phase = 'flop';
            cat.posture = 'sitting';
            cat.playOnce('SitDown', () => cat.setIdleClip('Sit_Idle'));
          } else this.phase = 'chase';
        }
        break;
      }
      case 'flop':          // preguiçoso: senta olhando o brinquedo; só se levanta quando ele some
        cat.faceTo(tgt.x, tgt.z);
        break;
      default:
    }
  }

  abort(b) {
    const cat = b.cat;
    if (this.phase === 'crouch' || this.phase === 'leap') cat.cancelOnce();
    cat.releasePounce();
    cat.faceTo(null);
    cat.stopMoving();
    if (cat.posture !== 'stand') { cat.posture = 'stand'; cat.setIdleClip('Idle'); }
  }
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
