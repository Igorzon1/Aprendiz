import * as THREE from 'three';
import { Animator } from './Animator.js';
import { PLAYER } from './config.js';
import { Emitter, angleDiff, clamp, damp, dampAngle, smoothstep, turnToward, yawOf } from './util.js';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _axis = { x: 0, y: 0 };

/** Clips substitutos quando o clip pedido ainda não existe no GLB. */
const FALLBACKS = {
  WakeUp: ['Idle_AFK', 'Idle'],
  Attack_Basic: ['Idle'],
  Interact: ['Idle'],
  Surprised: ['Idle'],
  Idle_AFK: ['Idle'],
  Idle_AFK_Toy: ['Idle_AFK', 'Idle'],
  Hit: ['Surprised', 'Idle'],
  Defeat: ['Surprised', 'Idle'],
  Cheer: ['Excited', 'Surprised', 'Idle'],
  ReceiveWand: ['Interact', 'Idle'],
  Dodge: ['Run', 'Idle'],
  Block: ['Idle'],
  Block_Hit: ['Surprised', 'Idle'],
};

/** Clips de AFK: o osso que os gatos perseguem e os eventos que ligam/desligam a brincadeira. */
const AFK_PLAY = {
  Idle_AFK: { bone: 'fx_sparkles', on: 'sparkle_on', off: 'sparkle_off' },
  Idle_AFK_Toy: { bone: 'fx_toy_end', on: 'toy_out', off: 'toy_away' },
};

/**
 * A Aprendiz: movimento relativo à câmera, máquina de estados de animação (Idle/Walk/Run + clips
 * de uma vez), AFK, ataque básico, colisão contra a casa.
 */
export class Player extends Emitter {
  constructor({ asset, collision, input, cameraRig }) {
    super();
    this.collision = collision;
    this.input = input;
    this.cameraRig = cameraRig;

    this.root = new THREE.Group();
    this.root.name = 'Player';
    this.model = asset.scene;
    this.root.add(this.model);

    this.animator = new Animator(this.model, asset.clips, asset.events, { fps: asset.fps, rig: asset.rig ?? null });
    this.animator.on('event', (clip, evt) => this._onEvent(clip, evt));
    this.animator.on('finished', (clip) => this._onFinished(clip));

    this.head = this.model.getObjectByName('head') ?? null;
    this.wandTip = this.model.getObjectByName('fx_light') ?? null;

    this.pos = this.root.position;
    this.yaw = 0;
    this.vx = 0;
    this.vz = 0;
    this.speed = 0; // velocidade real (m/s) depois das colisões

    this.locks = new Set();   // quem travou os controles (história, interação...)
    this.busy = null;         // ação de uma vez em andamento
    this.locoName = null;     // clip de locomoção tocando (Idle/Walk/Run/Idle_AFK)
    this.afk = false;
    this.afkSince = 0;
    this.afkClipEndedAt = 0;
    this.turn = null;         // {yaw, resolve, t}
    this.script = null;       // movimento roteirizado {x,z,speed,stopDist,resolve}
    this.attackCooldown = 0;
    // v0.4: esquiva (Espaço) e escudo mágico (botão direito / K)
    this.dodging = null;      // {t, dirX, dirZ, k}
    this.dodgeCd = 0;
    this.dodgeBuf = 0;
    this.iframes = 0;         // s de invencibilidade da esquiva (PlayerVitals respeita)
    this.blocking = false;
    this.blockAim = null;     // {x, z}: o Game passa o ponto do mouse (ou null com o teclado)
    this.blockHitCd = 0;
    this.canCast = () => true; // gancho: o Game liga na varinha (Progression)
    this.hasWand = () => true; // gancho: AFK com varinha (brilho) ou sem (brinquedo de barbante)
    this.defeated = false;
    this.afkPlaying = null;    // {clip, bone}: brincadeira de AFK em andamento (os gatos perseguem o osso)
    this.afkBones = {
      Idle_AFK: this.model.getObjectByName('fx_sparkles') ?? null,
      Idle_AFK_Toy: this.model.getObjectByName('fx_toy_end') ?? null,
    };
  }

  get locked() { return this.locks.size > 0; }
  lock(who = 'misc') { this.locks.add(who); }
  unlock(who = 'misc') { this.locks.delete(who); }

  /** Vetor "para frente" no plano XZ. */
  forward(out = new THREE.Vector3()) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  spawn(x, z, yaw) {
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
    this.vx = this.vz = this.speed = 0;
    this.locoName = null;
    this.animator.play('Idle', { fade: 0 });
    this.locoName = 'Idle';
    this.animator.update(0.001);
  }

  /** Move a Aprendiz para um ponto (troca de cenário, volta para casa). */
  teleport(x, z, yaw = this.yaw) {
    if (this.busy) this._endBusy();
    if (this.script) { const r = this.script.resolve; this.script = null; r(); }
    if (this.turn) { const r = this.turn.resolve; this.turn = null; r(); }
    this.dodging = null;
    this.blocking = false;
    this.pos.set(x, 0, z);
    this.yaw = yaw;
    this.root.rotation.y = yaw;
    this.vx = this.vz = this.speed = 0;
    this._stopAfkPlay();
    this.afk = false;
    this.locoName = null;
  }

  /** Levou um golpe: toca Hit e dá um pequeno empurrão para longe de (fromX, fromZ). NÃO mexe em vida. */
  hurt(fromX, fromZ) {
    if (this.defeated) return Promise.resolve();
    this._stopAfkPlay();
    this.dodging = null;
    let dx = this.pos.x - fromX, dz = this.pos.z - fromZ;
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) { dx = -Math.sin(this.yaw); dz = -Math.cos(this.yaw); } else { dx /= l; dz /= l; }
    this.vx = dx * PLAYER.hurtKnockback;
    this.vz = dz * PLAYER.hurtKnockback;
    this.attackCooldown = Math.max(this.attackCooldown, 0.25);
    this.input.lastActivity = performance.now();
    return this.playAction('Hit', { fade: 0.06 });
  }

  /** Cai (Defeat) e fica travada no chão. A Promise resolve quando o clip termina. */
  defeat() {
    if (this.defeated) return Promise.resolve();
    this._stopAfkPlay();
    this.defeated = true;
    this.dodging = null;
    this.blocking = false;
    this.vx = this.vz = 0;
    this.script = null;
    this.turn = null;
    return this.playAction('Defeat', { fade: 0.1 });
  }

  /** Levanta de novo e devolve os controles. */
  revive() {
    this.defeated = false;
    this.dodging = null;
    this.iframes = 0;
    this.dodgeCd = 0;
    if (this.busy) this._endBusy();
    this.vx = this.vz = this.speed = 0;
    this.locoName = null;
    this.afk = false;
    this.animator.play('Idle', { fade: 0.25 });
    this.locoName = 'Idle';
  }

  // ----- brincadeira de AFK (brinquedo / brilho): os gatos perseguem o osso -------------------------
  /** Posição de mundo do osso que os gatos perseguem agora (ou null). */
  afkTargetWorld(out = new THREE.Vector3()) {
    const a = this.afkPlaying;
    if (!a || !a.bone) return null;
    return a.bone.getWorldPosition(out);
  }

  _startAfkPlay(clip) {
    const bone = this.afkBones[clip];
    if (!bone || this.afkPlaying) return;
    this.afkPlaying = { clip, bone };
    this.emit('afkPlay', 'start', bone.name);
  }

  _stopAfkPlay() {
    const a = this.afkPlaying;
    if (!a) return;
    this.afkPlaying = null;
    this.emit('afkPlay', 'stop', a.bone.name);
  }

  headWorld(out = new THREE.Vector3()) {
    if (this.head) return this.head.getWorldPosition(out);
    return out.set(this.pos.x, this.pos.y + 0.65, this.pos.z);
  }

  wandTipWorld(out = new THREE.Vector3()) {
    if (this.wandTip) return this.wandTip.getWorldPosition(out);
    return this.forward(out).multiplyScalar(0.3).add(this.pos).setY(0.5);
  }

  // --------------------------------------------------------------------------------------------
  // Ações de uma vez (Interact, Surprised, Attack_Basic, WakeUp...)
  // --------------------------------------------------------------------------------------------
  /**
   * Toca um clip de uma vez. A Aprendiz fica "ocupada" até o clip terminar (ou, com `cancelAfter`,
   * até ela se mover depois desse evento). Retorna uma Promise resolvida quando terminar.
   * @param {string} name
   * @param {{events?:Record<string,Function>, cancelAfter?:string, faceYaw?:number, fade?:number}} [o]
   */
  playAction(name, { events = {}, cancelAfter = null, faceYaw = null, fade = 0.18 } = {}) {
    if (this.busy) this._endBusy(true);
    this._stopAfkPlay();
    return new Promise((resolve) => {
      this.busy = { name, events, cancelAfter, cancelable: false, resolve, faceYaw };
      this.animator.play(name, { fade, fallback: FALLBACKS[name] ?? ['Idle'] });
      this.locoName = null;
    });
  }

  _endBusy() {
    const b = this.busy;
    if (!b) return;
    this.busy = null;
    this.locoName = null; // a locomoção reassume no próximo quadro
    b.resolve();
  }

  _onEvent(clip, evt) {
    const b = this.busy;
    if (b && b.name === clip) {
      b.events[evt]?.();
      if (b.cancelAfter === evt) b.cancelable = true;
    }
    const ap = AFK_PLAY[clip];
    if (ap && this.locoName === clip) {
      if (evt === ap.on) this._startAfkPlay(clip);
      else if (evt === ap.off) this._stopAfkPlay();
    }
    this.emit('animEvent', clip, evt);
  }

  _onFinished(clip) {
    if (clip === 'Block_Hit' && this.locoName === 'Block_Hit') { this.locoName = null; return; }
    if (this.busy && this.busy.name === clip) { this._endBusy(); return; }
    if (AFK_PLAY[clip] && this.locoName === clip) {
      this._stopAfkPlay();
      this.afkClipEndedAt = performance.now();
      this.locoName = null;
    }
  }

  /** Vira suavemente para um ponto/ângulo. Resolve ao terminar. */
  turnTo(target) {
    const yaw = typeof target === 'number' ? target : yawOf(target.x - this.pos.x, target.z - this.pos.z);
    if (this.turn) this.turn.resolve();
    return new Promise((resolve) => { this.turn = { yaw, resolve, t: 0 }; });
  }

  /** Anda até um ponto (roteirizado). Resolve ao chegar. */
  walkTo(x, z, { speed = PLAYER.walkSpeed, stopDist = 0.1 } = {}) {
    if (this.script) this.script.resolve();
    return new Promise((resolve) => { this.script = { x, z, speed, stopDist, resolve, t: 0 }; });
  }

  // --------------------------------------------------------------------------------------------
  // v0.4: esquiva e escudo
  // --------------------------------------------------------------------------------------------
  _canDodge() {
    if (!this.input.enabled || this.locked || this.defeated || this.script || this.dodging || this.dodgeCd > 0) return false;
    const b = this.busy;
    return !b || b.name === 'Attack_Basic' || b.cancelable;
  }

  _startDodge(dirX, dirZ) {
    const D = PLAYER.dodge;
    if (this.busy) this._endBusy();
    this._stopAfkPlay();
    if (this.turn) { const r = this.turn.resolve; this.turn = null; r(); }
    this.blocking = false;
    this.dodging = { t: 0, dirX, dirZ, k: 0 };
    this.iframes = D.iframes;
    this.yaw = yawOf(dirX, dirZ);
    this.root.rotation.y = this.yaw;
    this.attackCooldown = Math.max(this.attackCooldown, 0.25);
    this.animator.play('Dodge', { fade: 0.04, fallback: FALLBACKS.Dodge });
    this.locoName = 'Dodge';
    this.input.lastActivity = performance.now();
    this.emit('dodge', this.pos.x, this.pos.z, dirX, dirZ);
  }

  _updateDodge(dt) {
    const D = PLAYER.dodge, d = this.dodging;
    d.t += dt;
    const u = clamp((d.t - D.moveFrom) / (D.moveTo - D.moveFrom), 0, 1);
    const k = 1 - (1 - u) ** 3;                    // ease-out: snappy start, soft stop
    const step = D.distance * (k - d.k);
    d.k = k;
    if (step > 0) {
      const px = this.pos.x, pz = this.pos.z;
      this.collision.move(this.pos, d.dirX * step, d.dirZ * step, PLAYER.radius, PLAYER.height);
      const real = Math.hypot(this.pos.x - px, this.pos.z - pz) / Math.max(dt, 1e-4);
      this.vx = d.dirX * real; this.vz = d.dirZ * real; this.speed = real;
    } else { this.vx = this.vz = this.speed = 0; }
    this.root.rotation.y = this.yaw;
    this.animator.update(dt);
    if (d.t >= D.duration) {
      this.dodging = null;
      this.locoName = null;
      this.dodgeCd = D.cooldown;
      this.vx = d.dirX * 0.4; this.vz = d.dirZ * 0.4;
      this.emit('dodgeEnd', this.pos.x, this.pos.z);
    }
  }

  /** O golpe vindo de (fromX, fromZ) bate na bolha (cone frontal de ~120 graus)? */
  blockCovers(fromX, fromZ) {
    if (!this.blocking || this.defeated || typeof fromX !== 'number' || typeof fromZ !== 'number') return false;
    const dx = fromX - this.pos.x, dz = fromZ - this.pos.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) return true;
    return (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / l >= PLAYER.block.coneCos;
  }

  /** Um golpe foi bloqueado: Block_Hit, empurrãozinho e evento 'blocked' (o Game faz a faísca). */
  onBlocked(fromX, fromZ) {
    this.blockHitCd = PLAYER.block.hitHold;
    this.animator.play('Block_Hit', { fade: 0.04, fallback: FALLBACKS.Block_Hit });
    this.locoName = 'Block_Hit';
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ, l = Math.hypot(dx, dz) || 1;
    this.vx += (dx / l) * 1.4; this.vz += (dz / l) * 1.4;
    this.emit('blocked', fromX, fromZ);
  }

  /** Ataque básico (J / clique). `aim` = ponto de mira opcional (mouse). */
  tryAttack(aim = null, { force = false } = {}) {
    if ((this.locked && !force) || this.busy || this.script || this.attackCooldown > 0 || this.dodging || this.blocking) return false;
    if (!this.canCast()) { this.attackCooldown = 0.35; return false; }
    this.attackCooldown = PLAYER.attackCooldown;
    const faceYaw = aim ? yawOf(aim.x - this.pos.x, aim.z - this.pos.z) : null;
    // Promise que resolve quando a Aprendiz volta a ficar livre
    return this.playAction('Attack_Basic', {
      cancelAfter: 'release',
      faceYaw,
      fade: 0.12,
      events: { release: () => this.emit('attackRelease') },
    });
  }

  // --------------------------------------------------------------------------------------------
  // Atualização
  // --------------------------------------------------------------------------------------------
  update(dt) {
    const input = this.input;
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.dodgeBuf = Math.max(0, this.dodgeBuf - dt);
    this.iframes = Math.max(0, this.iframes - dt);
    this.blockHitCd = Math.max(0, this.blockHitCd - dt);

    if (this.defeated) {          // caída: segura a última pose do Defeat
      this.vx = this.vz = this.speed = 0;
      this.animator.update(dt);
      return;
    }

    // --- direção desejada
    input.axis(_axis);
    const hasInput = (_axis.x !== 0 || _axis.y !== 0) && !this.locked;
    let dirX = 0, dirZ = 0;
    if (hasInput) {
      this.cameraRig.basis(_fwd, _right);
      dirX = _right.x * _axis.x + _fwd.x * _axis.y;
      dirZ = _right.z * _axis.x + _fwd.z * _axis.y;
      const l = Math.hypot(dirX, dirZ) || 1;
      dirX /= l; dirZ /= l;
    }

    // --- esquiva (Espaço): rolamento com invencibilidade; o pedido fica guardado por um instante
    if (input.dodgePressed) this.dodgeBuf = PLAYER.dodge.buffer;
    if (this.dodgeBuf > 0 && this._canDodge()) {
      if (hasInput) this._startDodge(dirX, dirZ);
      else { this.forward(_fwd); this._startDodge(_fwd.x, _fwd.z); }
      this.dodgeBuf = 0;
    }
    if (this.dodging) { this._updateDodge(dt); return; }

    // --- escudo (botão direito / K): precisa da varinha, não pode estar em ação
    this.blocking = input.blockHeld && !this.locked && !this.busy && !this.script && this.hasWand();

    // --- ocupado (ação de uma vez)?
    const busy = this.busy;
    let canMove = !busy && !this.locked;
    if (busy) {
      if (busy.cancelable && hasInput) this._endBusy();
      else if (busy.faceYaw !== null) this.yaw = dampAngle(this.yaw, busy.faceYaw, 22, dt);
      canMove = !this.busy && !this.locked;
    }

    // --- movimento roteirizado (cutscenes)
    let scriptDir = null;
    if (this.script && !this.busy) {
      const s = this.script;
      const dx = s.x - this.pos.x, dz = s.z - this.pos.z, d = Math.hypot(dx, dz);
      s.t += dt;
      if (d <= s.stopDist || s.t > 12) { this.script = null; s.resolve(); } else scriptDir = { x: dx / d, z: dz / d, speed: s.speed };
    }

    // --- velocidade
    let wantSpeed = 0;
    let run = false;
    if (scriptDir) {
      dirX = scriptDir.x; dirZ = scriptDir.z;
      wantSpeed = scriptDir.speed;
      run = scriptDir.speed > (PLAYER.walkSpeed + PLAYER.runSpeed) / 2;
    } else if (canMove && hasInput) {
      run = input.run && !this.blocking;
      wantSpeed = this.blocking ? PLAYER.walkSpeed * PLAYER.block.speedMul : (run ? PLAYER.runSpeed : PLAYER.walkSpeed);
      if (this.turn) { this.turn.resolve(); this.turn = null; } // o jogador assumiu o controle
    }

    const tvx = dirX * wantSpeed, tvz = dirZ * wantSpeed;
    const dvx = tvx - this.vx, dvz = tvz - this.vz;
    const dl = Math.hypot(dvx, dvz);
    if (dl > 1e-5) {
      const rate = (wantSpeed > 0 ? PLAYER.accel : PLAYER.decel) * dt;
      const k = Math.min(1, rate / dl);
      this.vx += dvx * k;
      this.vz += dvz * k;
    }

    // --- virar
    if (this.blocking && this.blockAim) {
      this.yaw = dampAngle(this.yaw, yawOf(this.blockAim.x - this.pos.x, this.blockAim.z - this.pos.z), 16, dt);
    } else if (wantSpeed > 0) {
      this.yaw = dampAngle(this.yaw, yawOf(dirX, dirZ), PLAYER.turnLambda, dt);
    } else if (this.turn) {
      const t = this.turn;
      t.t += dt;
      this.yaw = turnToward(this.yaw, t.yaw, 11 * dt);
      if (Math.abs(angleDiff(this.yaw, t.yaw)) < 0.03 || t.t > 1.0) { this.turn = null; t.resolve(); }
    }

    // --- mover com colisão
    const px = this.pos.x, pz = this.pos.z;
    if (Math.abs(this.vx) + Math.abs(this.vz) > 1e-4) {
      this.collision.move(this.pos, this.vx * dt, this.vz * dt, PLAYER.radius, PLAYER.height);
    }
    const real = Math.hypot(this.pos.x - px, this.pos.z - pz) / Math.max(dt, 1e-4);
    this.speed = damp(this.speed, real, 25, dt);
    this.root.rotation.y = this.yaw;

    // --- animação de locomoção (só quando livre)
    if (!this.busy) this._updateLocomotion(wantSpeed > 0, run, dt);
    this.animator.update(dt);
    if (this.animator.rig) this.animator.rig.speed = this.speed;
  }

  _updateLocomotion(moving, run, dt) {
    if (this.blocking) {
      if (this.locoName === 'Block_Hit') return;
      if (this.locoName !== 'Block') {
        this._stopAfkPlay();
        this.animator.play('Block', { fade: 0.1, fallback: FALLBACKS.Block });
        this.locoName = 'Block';
      }
      return;
    }
    const now = performance.now();
    const input = this.input;
    const idleFor = (now - input.lastActivity) / 1000;

    // AFK: depois de ~12 s sem entrada; qualquer entrada cancela.
    if (this.afk && input.lastActivity > this.afkSince) {
      this.afk = false;
      this.emit('afk', false);
      this._stopAfkPlay();
      if (AFK_PLAY[this.locoName]) this.locoName = null;
    }
    if (!this.afk && !moving && !this.locked && this.input.enabled && idleFor > PLAYER.afkAfter) {
      this.afk = true;
      this.afkSince = now;
      this.afkClipEndedAt = 0;
      this.emit('afk', true);
    }

    let want = 'Idle';
    if (moving) want = run ? 'Run' : 'Walk';
    else if (this.afk) {
      // sem varinha: brinquedinho de barbante; com varinha: o "laser" de brilhinho
      const clip = this.hasWand() ? 'Idle_AFK' : 'Idle_AFK_Toy';
      const playing = AFK_PLAY[this.locoName] ? this.locoName : null;
      const due = this.afkClipEndedAt === 0 || now - this.afkClipEndedAt > PLAYER.afkRepeat * 1000;
      if (playing) want = playing;
      else if (due && (this.animator.has(clip) || this.animator.has('Idle_AFK'))) want = this.animator.has(clip) ? clip : 'Idle_AFK';
    }

    if (want !== this.locoName) {
      const prev = this.locoName;
      const loop = want === 'Walk' || want === 'Run';
      if (AFK_PLAY[prev] && !AFK_PLAY[want]) this._stopAfkPlay();
      this.animator.play(want, {
        fade: AFK_PLAY[want] ? 0.35 : 0.2,
        timeScale: loop ? this._gaitScale(want) : 1,
        syncPhase: loop && (prev === 'Walk' || prev === 'Run'),
      });
      this.locoName = want;
    } else if (want === 'Walk' || want === 'Run') {
      // ajusta a velocidade do ciclo à velocidade real: menos "patinação" nos pés
      this.animator.setTimeScale(this._gaitScale(want));
    }
  }

  _gaitScale(clip) {
    const nominal = clip === 'Run' ? PLAYER.runSpeed : PLAYER.walkSpeed;
    return clamp(Math.max(this.speed, 0.35 * nominal) / nominal, 0.6, 1.45);
  }
}
