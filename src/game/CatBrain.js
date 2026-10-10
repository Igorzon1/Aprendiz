import { CAT } from './config.js';
import { FaceTask, IdleTask, MoveTask, OnceTask, PlayTask, PounceTask, SeqTask, SitTask, StandUpTask } from './CatTasks.js';
import { dampAngle, rand, weightedPick } from './util.js';

/**
 * Personalidades. Cada gato é independente: tem seu próprio lado/distância preferidos ao seguir,
 * sua própria cadência de atividades e reage ao mundo por conta própria.
 */
export const PERSONALITIES = {
  // Curiosa e elétrica: passeia muito, reage primeiro, de vez em quando dá um bote.
  Yumi: {
    followStart: 2.3,     // começa a seguir quando a Aprendiz está além disso
    followStop: 1.55,     // para de seguir quando chega nessa distância
    followDelay: 0.15,    // demora para perceber que ficou para trás (s)
    slotAngle: 0.95,      // lado preferido (rad a partir de "atrás" da Aprendiz): direita
    slotDist: 0.95,
    wanderMax: 2.1,       // raio do passeio em volta da Aprendiz
    wanderSpeed: 0.95,
    followSpeed: 1.15,
    runSpeed: 2.3,
    idleScale: 0.85,      // multiplicador das durações das atividades
    settleDelay: 0.6,     // atraso para se acomodar quando a Aprendiz fica AFK
    reactDelay: 0,
    weights: { stand: 14, look: 14, wander: 34, sit: 7, groom: 8, stretch: 8, meow: 7, pounce: 12, cuddle: 0 },
    play: { delay: 0.25, speed: 1.5, runSpeed: 2.4, crouch: [0.45, 0.85], pounceGap: 0.7, flopChance: 0 },   // ansiosa
  },
  // Preguiçoso e carinhoso: senta e se lambe mais, segue um pouco atrasado, ronrona perto dela.
  Petico: {
    followStart: 2.5,
    followStop: 1.8,
    followDelay: 1.1,
    slotAngle: -0.8,      // esquerda, um pouco mais longe
    slotDist: 1.25,
    wanderMax: 1.9,
    wanderSpeed: 0.7,
    followSpeed: 0.95,
    runSpeed: 1.9,
    idleScale: 1.35,
    settleDelay: 2.0,
    reactDelay: 0.7,
    weights: { stand: 16, look: 8, wander: 11, sit: 26, groom: 22, stretch: 13, meow: 4, pounce: 0, cuddle: 14 },
    play: { delay: 1.4, speed: 0.95, runSpeed: 1.6, crouch: [1.0, 1.8], pounceGap: 2.2, flopChance: 0.6 },   // preguiçoso, depois se joga no chão
  },
};

/**
 * Cérebro de um gato: escolhe tarefas (CatTasks) e reage a eventos. Modos:
 *  free   - atividades livres (parado, passear, sentar, lamber...)
 *  follow - acompanhando a Aprendiz até a distância confortável
 *  settle - Aprendiz AFK: o gato se aconchega perto dela e senta
 *  react  - reação roteirizada (geladeira); não é interrompida por seguir/passear
 */
export class CatBrain {
  /**
   * @param {import('./Cat.js').Cat} cat
   * @param {object} ctx {player, others():Cat[], nav, heading:{angle}}
   */
  constructor(cat, ctx) {
    this.cat = cat;
    this.player = ctx.player;
    this.ctx = ctx;
    this.p = PERSONALITIES[cat.name] ?? PERSONALITIES.Yumi;
    // pequena variação individual a cada partida: ninguém é exatamente igual
    this.slotAngle = this.p.slotAngle + rand(-0.15, 0.15);
    this.slotDist = this.p.slotDist + rand(-0.1, 0.1);

    this.mode = 'free';
    this.task = null;
    this.followT = 0;
    this.settleT = 0;
    this.shooCd = 0;
    this.startleCd = 0;
    this.running = false;
    this.last = null;
    this.pending = [];      // reações atrasadas [{t, fn}]
    this.playFn = null;     // () => Vector3|null : alvo em movimento da brincadeira do AFK
    this.threatsFn = null;  // () => [{x,z}] posições de inimigos
    this._threats = [];
    this._threatT = 0;
    this.startledAt = -99;
    this.cat.on('stuck', () => { if (this.task) this.task.done = true; });
    this.idleFor = rand(0.2, 1);
  }

  // ---------------------------------------------------------------------------------------------
  // API v0.2
  // ---------------------------------------------------------------------------------------------
  /** fn() devolve o ponto de mundo (Vector3) que o gato deve perseguir (osso do brinquedo/brilho), ou null. */
  setPlayTarget(fn) {
    this.playFn = fn ?? null;
  }

  /** fn() devolve a lista de posições {x, z} de inimigos: o gato os evita e leva um susto ao vê-los chegar. */
  setThreats(fn) {
    this.threatsFn = fn ?? null;
    this._threats = [];
  }

  /** Esquece a tarefa em andamento (troca de cenário). */
  reset() {
    if (this.task) this.task.abort(this);
    this.task = null;
    this.mode = 'free';
    this.pending.length = 0;
    this.followT = 0;
    this.settleT = 0;
  }

  /** Ameaça mais próxima de (x, z) dentro do raio r, ou null. */
  _threatNear(x, z, r) {
    let best = null, bd = r;
    for (const t of this._threats) {
      const d = Math.hypot(t.x - x, t.z - z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  _refreshThreats(dt) {
    this._threatT -= dt;
    if (this._threatT > 0) return;
    this._threatT = 0.15;
    this._threats = this.threatsFn ? (this.threatsFn() ?? []) : [];
  }

  // ---------------------------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------------------------
  get dPlayer() { return this.cat.distTo(this.player.pos.x, this.player.pos.z); }
  _others() { return this.ctx.others().filter((c) => c !== this.cat && c.active); }

  /** Ponto de acompanhamento: atrás da Aprendiz, do lado preferido deste gato. */
  slot(out = { x: 0, z: 0 }) {
    let a = this.ctx.heading.angle + Math.PI + this.slotAngle;
    const th = this._threats.length ? this._threatNear(this.player.pos.x, this.player.pos.z, CAT.threat.awareRange) : null;
    if (th) a = Math.atan2(this.player.pos.x - th.x, this.player.pos.z - th.z) + this.slotAngle * 0.5;   // atrás dela, longe do inimigo
    const x = this.player.pos.x + Math.sin(a) * this.slotDist;
    const z = this.player.pos.z + Math.cos(a) * this.slotDist;
    const f = this.ctx.nav.nearestFree(x, z, 1.2);
    out.x = f ? f.x : x;
    out.z = f ? f.z : z;
    return out;
  }

  _pointAroundPlayer(minR, maxR, tries = 14) {
    const nav = this.ctx.nav;
    const others = this._others();
    for (let i = 0; i < tries; i++) {
      const a = rand(0, Math.PI * 2);
      const r = rand(minR, maxR);
      const x = this.player.pos.x + Math.sin(a) * r;
      const z = this.player.pos.z + Math.cos(a) * r;
      if (!nav.isFree(x, z)) continue;
      if (this._threats.length && this._threatNear(x, z, CAT.threat.keepAway)) continue;
      if (others.some((o) => Math.hypot(o.pos.x - x, o.pos.z - z) < 0.7)) continue;
      const path = nav.findPath(this.cat.pos.x, this.cat.pos.z, x, z);
      if (!path || !path.length) continue;
      let len = 0, px = this.cat.pos.x, pz = this.cat.pos.z;
      for (const w of path) { len += Math.hypot(w.x - px, w.z - pz); px = w.x; pz = w.z; }
      if (len > 5) continue;
      return { x, z };
    }
    return null;
  }

  _playerPoint() { return { x: this.player.pos.x, z: this.player.pos.z }; }

  /** Troca a tarefa atual. Se o gato está sentado e a tarefa precisa dele em pé, levanta antes. */
  setTask(task, { urgent = false } = {}) {
    if (this.task) this.task.abort(this);
    this.cat.cancelOnce();
    this.cat.faceTo(null);
    if (this.cat.posture !== 'stand' && task.needsStanding) {
      if (urgent) {
        this.cat.posture = 'stand';
        this.cat.setIdleClip('Idle');
      } else {
        task = new SeqTask([new StandUpTask(), task]);
      }
    }
    this.task = task;
    task.start(this);
  }

  // ---------------------------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------------------------
  update(dt) {
    const cat = this.cat;
    this.shooCd = Math.max(0, this.shooCd - dt);
    this.startleCd = Math.max(0, this.startleCd - dt);

    for (let i = this.pending.length - 1; i >= 0; i--) {
      this.pending[i].t -= dt;
      if (this.pending[i].t <= 0) { const fn = this.pending[i].fn; this.pending.splice(i, 1); fn(); }
    }

    const d = this.dPlayer;
    const p = this.p;

    if (this.threatsFn) this._refreshThreats(dt);
    else if (this._threats.length) this._threats = [];

    // inimigos por perto: um susto (uma vez) e depois fica longe deles
    if (this._threats.length && this.mode !== 'react' && !cat.leap) {
      if (this._avoidThreats()) { /* a tarefa de fuga assumiu */ }
    }

    // brincadeira do AFK: o brinquedo / brilho está em cena -> persegue
    if (this.mode !== 'react' && this.mode !== 'flee') {
      const target = this.playFn ? this.playFn() : null;
      if (target && this.mode !== 'play' && !this._threatNear(cat.pos.x, cat.pos.z, CAT.threat.keepAway)) {
        this.mode = 'play';
        this.setTask(new PlayTask(() => (this.playFn ? this.playFn() : null), p.play));
      }
    }

    if (this.mode !== 'react' && this.mode !== 'play' && this.mode !== 'flee') {
      // 1. Aprendiz AFK -> aconchega-se e senta
      if (this.player.afk && !this.playFn) {
        if (this.mode !== 'settle') {
          this.settleT += dt;
          if (this.settleT > p.settleDelay) this._startSettle();
        }
      } else {
        this.settleT = 0;
        // a Aprendiz voltou antes de o gato sentar: cancela o aconchego
        if (this.mode === 'settle' && cat.posture === 'stand' && this.task) {
          this.task.abort(this);
          this.task = null;
          this.mode = 'free';
        }
      }

      // 2. Abre espaço se a Aprendiz vier para cima (steering + um passinho de lado)
      if ((this.mode === 'free' || this.mode === 'settle') && this.shooCd <= 0 && !cat.leap && !cat.ghost) {
        if (d < 0.5 || (d < 0.75 && this.player.speed > 0.7)) this._startShoo();
      }

      // 3. Ficou para trás -> segue
      if ((this.mode === 'free') && !this.player.afk) {
        if (d > p.followStart) {
          this.followT += dt;
          if (this.followT >= p.followDelay) this._startFollow();
        } else {
          this.followT = 0;
        }
      }
    }

    if (this.task) {
      this.task.update(dt, this);
      if (this.task.done) this._onTaskDone();
    } else {
      this._chooseNext();
    }
  }

  /** Perto de um inimigo? Susto (uma vez) e foge para um ponto seguro atrás da Aprendiz. Retorna true se agiu. */
  _avoidThreats() {
    const cat = this.cat;
    const T = CAT.threat;
    const near = this._threatNear(cat.pos.x, cat.pos.z, T.keepAway);
    const startle = this._threatNear(cat.pos.x, cat.pos.z, T.startleRange);
    const now = performance.now() / 1000;
    if (startle && now - this.startledAt > T.startleCooldown && this.mode !== 'flee' && !cat.leap) {
      this.startledAt = now;
      this.mode = 'flee';
      cat.faceTo(startle.x, startle.z);
      this.setTask(new SeqTask([new OnceTask('Startled'), this._fleeTask(near ?? startle)]), { urgent: true });
      return true;
    }
    if (near && this.mode !== 'flee') {
      this.mode = 'flee';
      this.setTask(this._fleeTask(near), { urgent: true });
      return true;
    }
    return false;
  }

  _fleeTask(threat) {
    const T = CAT.threat;
    const player = this.player.pos;
    const nav = this.ctx.nav;
    const need = T.keepAway + T.margin;
    const minThreat = (x, z) => this._threats.reduce((m, t) => Math.min(m, Math.hypot(t.x - x, t.z - z)), 99);
    // pontos a partir da Aprendiz, no lado oposto ao inimigo, cada vez mais longe, até achar um que esteja a salvo
    const base = Math.atan2(player.x - threat.x, player.z - threat.z);
    let best = null, bestScore = -1;
    for (const r of [this.slotDist, 2.4, 3.4, 4.6, 6]) {
      for (let i = 0; i < 9; i++) {
        const a = base + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.4;
        const f = nav.nearestFree(player.x + Math.sin(a) * r, player.z + Math.cos(a) * r, 0.8);
        if (!f) continue;
        const m = minThreat(f.x, f.z);
        if (m > bestScore) { bestScore = m; best = f; }
        if (m >= need) { best = f; bestScore = 99; break; }
      }
      if (bestScore >= 99) break;
    }
    if (!best) best = nav.nearestFree(player.x, player.z, 1.5) ?? { x: player.x, z: player.z };
    return new SeqTask([
      new MoveTask(best, { speed: this.p.runSpeed, stopDist: 0.2, timeout: 7 }),
      new IdleTask('Idle', rand(0.8, 1.6), { look: true }),
    ]);
  }

  _onTaskDone() {
    this.task = null;
    const wasMode = this.mode;
    if (wasMode === 'follow' || wasMode === 'react' || wasMode === 'play' || wasMode === 'flee') this.mode = 'free';
    if (wasMode === 'settle') {
      // acabou de se levantar (Aprendiz voltou) ou foi interrompido (olhar etc.)
      this.mode = this.player.afk ? 'settle' : 'free';
      if (this.mode === 'settle') { this._startSettle(); return; }
    }
    this._chooseNext();
  }

  // ---------------------------------------------------------------------------------------------
  // Atividades livres
  // ---------------------------------------------------------------------------------------------
  _chooseNext() {
    this.mode = 'free';
    const w = { ...this.p.weights };
    if (this.last) w[this.last] *= 0.3; // evita repetir a mesma coisa
    const d = this.dPlayer;
    if (d > 3) { w.cuddle = 0; w.pounce = 0; }
    const kind = weightedPick(Object.entries(w));
    const task = this._makeActivity(kind) ?? this._makeActivity('stand');
    this.last = kind;
    this.setTask(task);
  }

  _dur() { return rand(2, 7) * this.p.idleScale; }

  _makeActivity(kind) {
    const p = this.p;
    const player = () => this._playerPoint();
    switch (kind) {
      case 'stand':
        return new IdleTask('Idle', this._dur(), { look: true });
      case 'look':
        return new IdleTask('Idle', this._dur() * 0.7, { look: true });
      case 'wander': {
        const spot = this._pointAroundPlayer(0.9, p.wanderMax);
        if (!spot) return null;
        return new SeqTask([
          new MoveTask(spot, { speed: p.wanderSpeed, stopDist: 0.08 }),
          new IdleTask('Idle', rand(0.8, 2.2), { look: true }),
        ]);
      }
      case 'sit':
        return new SitTask({ time: this._dur() + 1.5, faceTarget: Math.random() < 0.5 ? player : null });
      case 'groom':
        return new SeqTask([new OnceTask('Groom', { times: Math.random() < 0.4 ? 2 : 1 }), new IdleTask('Idle', rand(0.6, 1.6))]);
      case 'stretch':
        return new SeqTask([new OnceTask('Stretch'), new IdleTask('Idle', rand(0.6, 1.5), { look: true })]);
      case 'meow':
        return new SeqTask([new FaceTask(player, 0.5), new OnceTask('Meow', { faceTarget: player }), new IdleTask('Idle', rand(0.5, 1.5))]);
      case 'pounce': {
        const a = rand(0, Math.PI * 2);
        const r = rand(0.7, 1.1);
        const x = this.cat.pos.x + Math.sin(a) * r;
        const z = this.cat.pos.z + Math.cos(a) * r;
        if (!this.ctx.nav.isFree(x, z)) return null;
        return new SeqTask([new IdleTask('Idle', rand(0.4, 0.9)), new PounceTask(x, z, rand(0.45, 0.75)), new IdleTask('Idle', rand(0.8, 2))]);
      }
      case 'cuddle': {
        // vem para perto da Aprendiz, vira para ela e ronrona
        const spot = this._pointAroundPlayer(0.65, 0.95, 18);
        const tasks = [];
        if (spot && this.dPlayer > 1.2) tasks.push(new MoveTask(spot, { speed: p.wanderSpeed, stopDist: 0.1 }));
        tasks.push(new FaceTask(player, 0.5));
        tasks.push(new IdleTask('Purr', rand(3, 6), { faceTarget: player }));
        return new SeqTask(tasks);
      }
      default:
        return null;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Modos
  // ---------------------------------------------------------------------------------------------
  _startFollow() {
    this.mode = 'follow';
    this.followT = 0;
    this.running = this.dPlayer > 3.6;
    const p = this.p;
    const speed = () => {
      const d = this.dPlayer;
      if (d > 3.6) this.running = true;
      else if (d < 2.4) this.running = false;
      return this.running ? p.runSpeed : p.followSpeed;
    };
    const task = new MoveTask(() => this.slot(), {
      speed,
      stopDist: 0.25,
      retarget: 0.3,
      timeout: 20,
      stopWhen: () => this.dPlayer < p.followStop,
    });
    this.setTask(task);
  }

  _startShoo() {
    this.shooCd = 1.6;
    const cat = this.cat;
    const player = this.player;
    let dx = cat.pos.x - player.pos.x, dz = cat.pos.z - player.pos.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-3) { dx = Math.sin(player.yaw); dz = Math.cos(player.yaw); } else { dx /= l; dz /= l; }
    const a = Math.atan2(dx, dz) + rand(-0.6, 0.6);
    const r = rand(1.0, 1.35);
    const f = this.ctx.nav.nearestFree(player.pos.x + Math.sin(a) * r, player.pos.z + Math.cos(a) * r, 1);
    if (!f) return;
    this.mode = 'free';
    const speed = player.speed > 1.8 ? this.p.runSpeed : this.p.followSpeed;
    this.setTask(new SeqTask([new MoveTask(f, { speed, stopDist: 0.12, timeout: 5 }), new IdleTask('Idle', rand(0.4, 1.0), { look: true })]), { urgent: true });
  }

  _startSettle() {
    this.mode = 'settle';
    const d = this.dPlayer;
    const tasks = [];
    if (d > 1.7 || d < 0.6) {
      const a = this.ctx.heading.angle + Math.PI + this.slotAngle * 1.1;
      const r = 0.8 + (this.slotDist - 0.7) * 0.3;
      const f = this.ctx.nav.nearestFree(this.player.pos.x + Math.sin(a) * r, this.player.pos.z + Math.cos(a) * r, 1);
      if (f) tasks.push(new MoveTask(f, { speed: this.p.followSpeed, stopDist: 0.12, timeout: 10 }));
    }
    const player = () => this._playerPoint();
    tasks.push(new FaceTask(player, 0.4));
    tasks.push(new SitTask({ until: () => !this.player.afk, faceTarget: player }));
    this.setTask(new SeqTask(tasks));
  }

  // ---------------------------------------------------------------------------------------------
  // Reações
  // ---------------------------------------------------------------------------------------------
  /**
   * @param {'fridge'|'look'|'startle'} type
   * @param {object} data  fridge: {pos, spots:{[name]:{x,z}}}; look: {pos}; startle: {from}
   */
  react(type, data = {}) {
    if (!this.cat.active || this.cat.scripted) return;
    if (type === 'fridge') {
      this.pending.push({ t: this.p.reactDelay, fn: () => this._reactFridge(data) });
    } else if (type === 'look') {
      if (this.mode === 'react') return;
      const delay = this.p.reactDelay * 0.5 + rand(0, 0.25);
      this.pending.push({ t: delay, fn: () => this._reactLook(data) });
    } else if (type === 'startle') {
      if (this.mode !== 'free' || this.startleCd > 0 || this.cat.leap) return;
      this.startleCd = 8;
      this.setTask(new SeqTask([new OnceTask('Startled'), new IdleTask('Idle', rand(0.5, 1.2), { look: true })]), { urgent: true });
    }
  }

  _reactFridge({ pos, spots = {} }) {
    this.mode = 'react';
    this.followT = 0;
    const spot = spots[this.cat.name] ?? { x: pos.x, z: pos.z };
    const lookAtFridge = () => ({ x: pos.x, z: pos.z });
    const hold = this.cat.name === 'Petico'
      ? new SitTask({ time: rand(3, 5), faceTarget: lookAtFridge })
      : new IdleTask('Idle', rand(3, 5), { look: false, faceTarget: lookAtFridge });
    this.setTask(new SeqTask([
      new MoveTask(spot, { speed: this.p.runSpeed, stopDist: 0.15, timeout: 8 }),
      new FaceTask(lookAtFridge, 0.35),
      new OnceTask('Meow', { faceTarget: lookAtFridge }),
      hold,
    ]), { urgent: true });
  }

  _reactLook({ pos }) {
    if (this.mode === 'react' || this.cat.leap || this.cat.scripted) return;
    const wasSettle = this.mode === 'settle';
    const look = () => ({ x: pos.x, z: pos.z });
    const task = new SeqTask([new FaceTask(look, rand(1.2, 2.2)), new IdleTask(this.cat.posture === 'sitting' ? 'Sit_Idle' : 'Idle', rand(0.3, 0.8))]);
    if (wasSettle) this.mode = 'settle';
    else this.mode = 'free';
    this.setTask(task);
  }
}

/** Mantém o "rumo" suavizado da Aprendiz: usado para posicionar os gatos atrás dela. */
export function updateHeading(heading, player, dt) {
  heading.angle = dampAngle(heading.angle, player.yaw, 1.6, dt);
}

