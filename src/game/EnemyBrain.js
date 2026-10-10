import { SOMBRITO as C } from './configCombat.js';
import { rand } from './util.js';

/** Estados do Sombrito. */
export const ST = Object.freeze({
  IDLE: 'idle',       // parado no território (de vez em quando pisca)
  WANDER: 'wander',   // passeando dentro do território
  ALERT: 'alert',     // percebeu a Aprendiz: "!" e um instante de susto
  CHASE: 'chase',     // correndo atrás dela
  ATTACK: 'attack',   // golpe (dano no evento `hit` do clip)
  HURT: 'hurt',       // levou um raio
  LEASH: 'leash',     // desistiu e volta para casa
  DIE: 'die',         // derretendo (Despawn)
  DEAD: 'dead',       // sumiu; renasce depois
  SPAWN: 'spawn',     // renascendo (Spawn)
});

/**
 * Cérebro de um Sombrito: máquina de estados que comanda o corpo (Enemy).
 *   IDLE/WANDER -> ALERT -> CHASE <-> ATTACK, HURT em qualquer momento, LEASH quando desiste,
 *   DIE -> DEAD -> SPAWN -> IDLE.
 * `ctx` é o gerenciador Enemies: target() (posição da Aprendiz ou null), vitals, fx, playerPos().
 */
export class EnemyBrain {
  /**
   * @param {import('./Enemy.js').Enemy} enemy
   * @param {import('./Enemies.js').Enemies} ctx
   */
  constructor(enemy, ctx) {
    this.e = enemy;
    this.ctx = ctx;
    this.state = ST.IDLE;
    this.t = 0;
    this.cd = 0;              // recarga do ataque
    this.aggro = false;       // já sabe onde ela está (levou um raio / está perseguindo)
    this.idleFor = rand(C.idleMin, C.idleMax);
    this.blinkT = rand(C.blinkMin, C.blinkMax);
    this.noticed = false;     // evento `noticed` do Alert já passou?
    this.clipDone = false;
    this.hitFired = false;
    this.respawnT = 0;
    this.stunFor = C.hurtStun;
    this.wasAware = false;
    enemy.on('animEvent', (clip, evt) => this._onAnimEvent(clip, evt));
    this._enter(ST.IDLE);
  }

  /** Pode ser alvo de raios? (não enquanto nasce, derrete ou está sumido) */
  get targetable() {
    return this.state !== ST.DEAD && this.state !== ST.DIE && this.state !== ST.SPAWN;
  }

  set(state) {
    this.state = state;
    this.t = 0;
    this._enter(state);
  }

  // -----------------------------------------------------------------------------------------------
  // Entradas de cada estado
  // -----------------------------------------------------------------------------------------------
  _enter(state) {
    const e = this.e;
    switch (state) {
      case ST.IDLE:
        e.stop();
        e.faceTo(null);
        e.setIdleClip('Idle');
        this.idleFor = rand(C.idleMin, C.idleMax);
        break;

      case ST.WANDER: {
        const p = this._wanderPoint();
        if (!p) { this.set(ST.IDLE); return; }
        e.faceTo(null);
        e.moveTo(p.x, p.z, C.wanderSpeed, 0.1);
        break;
      }

      case ST.ALERT: {
        const tgt = this.ctx.target();
        e.stop();
        if (tgt) e.faceTo(tgt.x, tgt.z);
        this.noticed = false;
        this.clipDone = false;
        e.cancelOnce();
        e.playOnce('Alert', () => { this.clipDone = true; }, { fade: 0.1 });
        if (!e.has('Alert')) e.hop(); // sem o clip: um pulinho de susto
        break;
      }

      case ST.CHASE:
        e.faceTo(null);
        this.aggro = true;
        break;

      case ST.ATTACK: {
        const tgt = this.ctx.target();
        e.stop();
        if (tgt) e.faceTo(tgt.x, tgt.z);
        this.hitFired = false;
        e.cancelOnce();
        e.playOnce('Attack', () => { this.cd = C.attackCooldown; this.set(ST.CHASE); }, { fade: 0.1 });
        break;
      }

      case ST.HURT:
        e.stop();
        e.faceTo(null);
        e.cancelOnce();
        e.playOnce('Hit', null, { fade: 0.06 });
        this.stunFor = e.has('Hit') ? Math.min(Math.max(e.animator.duration('Hit'), 0.3), 0.6) : C.hurtStun;
        break;

      case ST.LEASH:
        this.aggro = false;
        e.faceTo(null);
        e.cancelOnce();
        e.moveTo(e.spawn.x, e.spawn.z, C.leashSpeed, 0.35);
        break;

      case ST.DIE:
        e.stop();
        e.faceTo(null);
        e.cancelOnce();
        e.playOnce('Despawn', () => this._finishDeath(), { fade: 0.08 });
        if (!e.has('Despawn')) e.procScale(-1, 0.9);
        this.ctx.fx.drop(e.pos.x, e.pos.z, 0.1);
        break;

      case ST.DEAD:
        this.respawnT = C.respawnDelay;
        break;

      case ST.SPAWN:
        e.resetToSpawn();
        e.stop();
        e.faceTo(null);
        this.ctx.fx.poof(e.pos.x, 0.1, e.pos.z, { scale: 0.6, count: 4, sparks: 8 });
        e.playOnce('Spawn', () => { if (this.state === ST.SPAWN) this.set(ST.IDLE); }, { fade: 0 });
        if (!e.has('Spawn')) e.procScale(1, 0.7);
        break;

      default:
    }
  }

  _wanderPoint() {
    const e = this.e;
    const col = this.ctx.collision;
    const r = Math.max(0.5, e.territory * C.wanderRadiusK);
    for (let i = 0; i < 8; i++) {
      const a = rand(0, Math.PI * 2);
      const d = Math.sqrt(Math.random()) * r;
      const x = e.spawn.x + Math.sin(a) * d;
      const z = e.spawn.z + Math.cos(a) * d;
      if (Math.hypot(x - e.pos.x, z - e.pos.z) < 0.5) continue;
      if (col.isFree(x, z, e.radius + 0.04, e.height)) return { x, z };
    }
    return null;
  }

  // -----------------------------------------------------------------------------------------------
  // Eventos vindos do corpo
  // -----------------------------------------------------------------------------------------------
  _onAnimEvent(clip, evt) {
    const e = this.e;
    if (clip === 'Alert' && evt === 'noticed' && this.state === ST.ALERT) {
      this.noticed = true;
      const h = e.headWorld();
      this.ctx.fx.text('!', h.x, h.y + 0.05, h.z, { scale: 0.5, life: 0.95 });
    } else if (clip === 'Attack' && evt === 'hit' && this.state === ST.ATTACK) {
      this._strike();
    } else if (clip === 'Spawn' && evt === 'can_act' && this.state === ST.SPAWN) {
      this.set(ST.IDLE);
    }
  }

  /** Instante do golpe: ainda perto e (mais ou menos) de frente? Então machuca. */
  _strike() {
    const e = this.e;
    this.hitFired = true;
    e.faceTo(null);
    const tgt = this.ctx.target();
    // pequeno bote para a frente
    e.kick(Math.sin(e.yaw), Math.cos(e.yaw), C.lunge);
    if (!tgt) return;
    const dx = tgt.x - e.pos.x, dz = tgt.z - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > C.hitRange) return;
    const dot = d > 1e-4 ? (dx * Math.sin(e.yaw) + dz * Math.cos(e.yaw)) / d : 1;
    if (dot < C.hitCone) return;
    this.ctx.vitals?.hit(C.damage, e.pos.x, e.pos.z);
  }

  /** O corpo levou dano. */
  onDamaged(lethal) {
    if (lethal) {
      this.set(ST.DIE);
      this.ctx.notifyKilled(this.e);
      return;
    }
    this.wasAware = this.aggro || this.state === ST.CHASE || this.state === ST.ATTACK || this.state === ST.ALERT;
    this.set(ST.HURT);
  }

  _finishDeath() {
    const e = this.e;
    this.ctx.fx.poof(e.pos.x, 0.12, e.pos.z, { scale: 1 });
    this.ctx.fx.drop(e.pos.x, e.pos.z, 0.15);
    e.root.visible = false;
    this.set(ST.DEAD);
  }

  // -----------------------------------------------------------------------------------------------
  // Percepção
  // -----------------------------------------------------------------------------------------------
  /** Ela está perto o bastante (e dentro do território + folga) para ele reparar? */
  _canNotice(tgt) {
    if (!tgt) return false;
    const e = this.e;
    if (Math.hypot(tgt.x - e.pos.x, tgt.z - e.pos.z) > C.notice) return false;
    return Math.hypot(tgt.x - e.spawn.x, tgt.z - e.spawn.z) <= e.territory + C.noticeTerritoryPad;
  }

  // -----------------------------------------------------------------------------------------------
  // Atualização
  // -----------------------------------------------------------------------------------------------
  update(dt) {
    const e = this.e;
    this.t += dt;
    this.cd = Math.max(0, this.cd - dt);
    const tgt = this.ctx.target();

    switch (this.state) {
      case ST.IDLE: {
        if (this._canNotice(tgt)) { this.set(ST.ALERT); break; }
        if (!e.once) {
          this.blinkT -= dt;
          if (this.blinkT <= 0) {
            this.blinkT = rand(C.blinkMin, C.blinkMax);
            if (e.has('Blink')) e.playOnce('Blink', null, { fade: 0.08 });
          }
        }
        if (this.t >= this.idleFor) this.set(e.territory > 0.6 ? ST.WANDER : ST.IDLE);
        break;
      }

      case ST.WANDER:
        if (this._canNotice(tgt)) { this.set(ST.ALERT); break; }
        if (e.arrived || e.stuck || this.t > 12) this.set(ST.IDLE);
        break;

      case ST.ALERT: {
        if (!tgt) { this.set(ST.IDLE); break; }
        e.faceTo(tgt.x, tgt.z);
        const ready = this.noticed && this.clipDone && this.t >= C.alertMin;
        if (ready || this.t >= C.alertMax) this.set(ST.CHASE);
        break;
      }

      case ST.CHASE: {
        if (!tgt) { this.set(ST.LEASH); break; }
        const dp = Math.hypot(tgt.x - e.pos.x, tgt.z - e.pos.z);
        const dHome = Math.hypot(e.pos.x - e.spawn.x, e.pos.z - e.spawn.z);
        if (dp > C.leashDist || dHome > e.territory + C.leashFromSpawn) { this.set(ST.LEASH); break; }
        if (dp <= C.attackRange && this.cd <= 0) { this.set(ST.ATTACK); break; }
        if (dp > C.holdRange) {
          e.faceTo(null);
          e.moveTo(tgt.x, tgt.z, C.chaseSpeed, C.holdRange);
        } else {
          e.stop();
          e.faceTo(tgt.x, tgt.z);
        }
        break;
      }

      case ST.ATTACK:
        if (!this.hitFired && tgt) e.faceTo(tgt.x, tgt.z);
        if (this.t > 2.6) { this.cd = C.attackCooldown; this.set(ST.CHASE); } // rede de segurança
        break;

      case ST.HURT:
        if (this.t >= this.stunFor) {
          if (!tgt) this.set(ST.LEASH);
          else this.set(this.wasAware ? ST.CHASE : ST.ALERT);
        }
        break;

      case ST.LEASH: {
        if (e.arrived || e.stuck || this.t > 14) {
          e.health.reset();
          this.set(ST.IDLE);
        }
        break;
      }

      case ST.DEAD: {
        this.respawnT -= dt;
        if (this.respawnT <= 0) {
          const pp = this.ctx.playerPos();
          const far = !pp || Math.hypot(pp.x - e.spawn.x, pp.z - e.spawn.z) > C.respawnMinPlayerDist;
          if (far) this.set(ST.SPAWN);
        }
        break;
      }

      case ST.DIE:
      case ST.SPAWN:
      default:
        break;
    }
  }
}
