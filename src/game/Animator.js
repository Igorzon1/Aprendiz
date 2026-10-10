import * as THREE from 'three';
import { Emitter } from './util.js';

/** Clips cíclicos (ver contrato): Idle, Walk, Run, Sit_Idle, Purr e os que terminam em `_Loop`. */
const LOOP_CLIPS = new Set(['Idle', 'Walk', 'Run', 'Sit_Idle', 'Purr', 'Talk', 'Block']);
export const isLoopClip = (name) => LOOP_CLIPS.has(name) || name.endsWith('_Loop');

/** Eventos padrão (quadro @30fps) usados quando o animations.json ainda não os traz. */
const DEFAULT_EVENTS = {
  Attack_Basic: { release: 9 },
  Interact: { grab: 12 },
  Pounce: { leap: 8, land: 20 },
  ReceiveWand: { take: 20 },
  GiveWand: { offer: 32, release: 44 },
};

/** Duração (s) de clips ausentes, para que as máquinas de estado continuem andando. */
const DEFAULT_DURATION = {
  WakeUp: 2.2, Attack_Basic: 0.7, Interact: 1.1, Surprised: 1.0, Idle_AFK: 3.0, Hit: 0.5,
  SitDown: 0.8, StandUp: 0.8, Groom: 2.6, Stretch: 1.6, Pounce: 1.0, Meow: 1.0, Startled: 0.7,
  ReceiveWand: 2.4, Cheer: 1.3, Defeat: 1.6, Idle_AFK_Toy: 4.0, Dodge: 0.47, Block_Hit: 0.33, Taunt: 1.3,
  Wave: 1.4, Excited: 1.4, GiveWand: 2.0, Point: 1.0,
};

/**
 * Envelope do AnimationMixer:
 *  - play(nome, {fade, timeScale, fallback}) com cross-fade;
 *  - eventos por quadro (animations.json) -> on('event', (clip, evento) => ...);
 *  - on('finished', (clip) => ...) quando um clip de execução única termina;
 *  - clips ausentes degradam: toca o primeiro `fallback` existente, mas o nome lógico continua
 *    sendo o pedido e os eventos/fim são simulados por um relógio "virtual". Assim o resto do
 *    jogo usa o mesmo caminho de código com ou sem os assets finais.
 *
 * Observação: SEMPRE há um clip tocando (efeitos FX só ficam escondidos porque as animações
 * escalam os ossos fx_* para ~0).
 */
export class Animator extends Emitter {
  /**
   * @param {THREE.Object3D} root
   * @param {Map<string, THREE.AnimationClip>} clips
   * @param {Record<string, Record<string, number>>} events   {clip: {evento: quadro}}
   * @param {{fps?:number, rig?:{play:Function}}} opts   rig = animador procedural (placeholders)
   */
  constructor(root, clips = new Map(), events = {}, { fps = 30, rig = null } = {}) {
    super();
    this.root = root;
    this.clips = clips;
    this.events = events;
    this.fps = fps;
    this.rig = rig;
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = new Map();
    this.action = null;      // ação real tocando
    this.current = null;     // nome lógico tocando
    this.virtual = null;     // {name, t, duration, events, fired:Set}
    this.timeScale = 1;
    this._lastTime = 0;
    this._finishedQueue = [];
    this.mixer.addEventListener('finished', (e) => this._finishedQueue.push(e.action));
  }

  has(name) { return this.clips.has(name); }

  duration(name) {
    const c = this.clips.get(name);
    return c ? c.duration : (DEFAULT_DURATION[name] ?? 1);
  }

  /** Tempo (s) do evento no clip, ou null. */
  eventTime(clip, evt) {
    const f = this.events[clip]?.[evt] ?? DEFAULT_EVENTS[clip]?.[evt];
    return f === undefined ? null : f / this.fps;
  }

  _eventsOf(clip) {
    const out = [];
    const src = { ...(DEFAULT_EVENTS[clip] ?? {}), ...(this.events[clip] ?? {}) };
    for (const [name, v] of Object.entries(src)) {
      if (typeof v === 'number') out.push([name, v / this.fps]);
    }
    return out;
  }

  _action(clipName) {
    let a = this.actions.get(clipName);
    if (!a) {
      a = this.mixer.clipAction(this.clips.get(clipName));
      this.actions.set(clipName, a);
    }
    return a;
  }

  _fadeTo(action, target, dur) {
    action._scheduleFading(dur, action.getEffectiveWeight(), target);
  }

  /**
   * Toca um clip. Retorna o nome lógico tocando.
   * @param {string} name
   * @param {{fade?:number,timeScale?:number,loop?:boolean,fallback?:string[],restart?:boolean,syncPhase?:boolean}} o
   */
  play(name, { fade = 0.2, timeScale = 1, loop, fallback = ['Idle'], restart = true, syncPhase = false } = {}) {
    const loops = loop ?? isLoopClip(name);
    if (!restart && this.current === name) {
      this.setTimeScale(timeScale);
      return name;
    }

    // Resolve o clip real (ou o substituto) e se é virtual.
    let real = null;
    let virtual = false;
    if (this.clips.has(name)) {
      real = name;
    } else {
      virtual = true;
      real = fallback.find((n) => n !== name && this.clips.has(n)) ?? null;
    }

    this.current = name;
    this.timeScale = timeScale;
    this.virtual = null;

    if (virtual && !loops) {
      // O fallback é um clip de execução única? Então usa a duração dele (ex.: WakeUp -> Idle_AFK).
      const fbOnce = real && !isLoopClip(real);
      const dur = fbOnce ? this.clips.get(real).duration : (DEFAULT_DURATION[name] ?? 1);
      this.virtual = { name, t: -1e-6, duration: dur, events: this._eventsOf(name), fired: new Set() };
    }

    this.rig?.play(name);

    if (!real) {
      // Sem nenhum clip (placeholder procedural): só o relógio virtual.
      if (this.action) { this._fadeTo(this.action, 0, fade); this.action = null; }
      return name;
    }

    const action = this._action(real);
    const prev = this.action;
    const realLoops = isLoopClip(real);

    // Se a ação já estava aparecendo (fade-out em andamento) e é cíclica, continua a fase.
    const resuming = realLoops && prev !== action && action.enabled && action.getEffectiveWeight() > 0.001;
    const startW = resuming ? action.getEffectiveWeight() : 0;
    if (!resuming) {
      action.reset();
      // Walk <-> Run: mantém a fase do passo para os pés não "pularem" na troca.
      if (syncPhase && prev && prev !== action && realLoops && this.realName && isLoopClip(this.realName)) {
        const pd = prev.getClip().duration;
        action.time = ((prev.time % pd) / pd) * action.getClip().duration;
      }
    }
    action.enabled = true;
    action.setLoop(realLoops ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !realLoops;
    action.setEffectiveTimeScale(timeScale);
    action.setEffectiveWeight(1);
    action.play();

    if (prev && prev !== action && fade > 0) {
      this._fadeTo(prev, 0, fade);
      action._scheduleFading(fade, startW, 1);
    } else if (prev && prev !== action) {
      prev.enabled = false;
    } else if (!prev && fade > 0) {
      action._scheduleFading(fade, 0, 1);
    }

    this.action = action;
    this.realName = real;
    this._lastTime = resuming ? action.time : -1e-6;
    this._virtualOnly = virtual;
    return name;
  }

  setTimeScale(ts) {
    this.timeScale = ts;
    if (this.action) this.action.setEffectiveTimeScale(ts);
  }

  /** Tempo (s) dentro do clip lógico atual. */
  get time() {
    if (this.virtual) return Math.max(0, this.virtual.t);
    return this.action ? this.action.time : 0;
  }

  update(dt) {
    this.rig?.update?.(dt);
    const action = this.action;
    const t0 = this._lastTime;
    this.mixer.update(dt);

    if (action && !this.virtual && this.current === this.realName) {
      this._fireRealEvents(action, t0);
      this._lastTime = action.time;
    }

    if (this.virtual) {
      const v = this.virtual;
      const t0v = v.t;
      v.t += dt * this.timeScale;
      for (const [evt, time] of v.events) {
        if (!v.fired.has(evt) && time > t0v && time <= v.t) { v.fired.add(evt); this.emit('event', v.name, evt); }
      }
      if (v.t >= v.duration) {
        this.virtual = null;
        this.emit('finished', v.name);
      }
    }

    // Eventos "finished" do mixer: despachados depois do update para que os ouvintes
    // possam chamar play() à vontade.
    if (this._finishedQueue.length) {
      const q = this._finishedQueue;
      this._finishedQueue = [];
      for (const a of q) {
        if (a === this.action && !this.virtual && this.current === this.realName) this.emit('finished', this.current);
      }
    }
  }

  _fireRealEvents(action, t0) {
    const clip = this.current;
    const evs = this._eventsOf(clip);
    if (!evs.length) return;
    const t1 = action.time;
    const dur = action.getClip().duration;
    const loops = isLoopClip(clip);
    for (const [name, raw] of evs) {
      const time = Math.min(raw, dur);
      let hit;
      if (!loops || t1 >= t0) hit = time > t0 && time <= t1;
      else hit = time > t0 || time <= t1; // deu a volta no loop
      if (hit) this.emit('event', clip, name);
    }
  }
}
