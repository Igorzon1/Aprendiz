import * as THREE from 'three';
import { isLoopClip } from './Animator.js';
import { OBJ_ENTER_FOREST } from './configForest.js';
import { yawOf } from './util.js';

/** Pontos de cena que podem faltar no House.glb: tenta estes substitutos em ordem. */
const POINT_ALIASES = {
  PATH_CatOutside: ['SPAWN_PeticoReturn', 'SPAWN_Petico'],
  PATH_CatFlapIn: ['SPAWN_Petico', 'SPAWN_Yumi'],
  CatFlap: ['PATH_CatFlapIn', 'PATH_CatOutside'],
  Fridge_Door: ['INT_Fridge'],
};

/**
 * "Mundo" que o Story.js controla: traduz nomes de atores/pontos e passos genéricos
 * (say, moveTo, playClip...) para o Game. Veja o cabeçalho de Story.js.
 */
export class StoryWorld {
  constructor(game) {
    this.game = game;
  }

  // ----- atores e pontos -------------------------------------------------------------------------
  actor(name) {
    const g = this.game;
    if (name === 'Aprendiz' || name === 'player') return { kind: 'player', obj: g.player, pos: g.player.pos };
    const cat = g.cats[name];
    if (cat) return { kind: 'cat', obj: cat, pos: cat.pos };
    const npc = g.npcs?.[name];
    if (npc) return { kind: 'npc', obj: npc, pos: npc.pos };
    return null;
  }

  /** Posição de mundo de um ator, ponto nomeado ou {x,z}. Retorna um Vector3 novo ou null. */
  point(spec) {
    const g = this.game;
    if (!spec) return null;
    if (typeof spec === 'object') return new THREE.Vector3(spec.x ?? 0, spec.y ?? 0, spec.z ?? 0);
    const a = this.actor(spec);
    if (a) return a.pos.clone();
    for (const name of [spec, ...(POINT_ALIASES[spec] ?? [])]) {
      const p = g.world.point(name);
      if (p) return p;
    }
    console.warn(`[StoryWorld] ponto de cena não encontrado: "${spec}"`);
    return null;
  }

  // ----- Story: interface -----------------------------------------------------------------------
  say(text, { speaker = 'Aprendiz', duration, at } = {}) {
    return this.game.say(text, { speaker, duration, at });
  }

  hint(text, ms, at) { this.game.hint(text, ms, at); }

  fade(to, ms) { return this.game.ui.fade(to, ms); }

  playClip(actorName, clip, { loop, ms } = {}) {
    const a = this.actor(actorName);
    if (!a) return Promise.resolve();
    if (a.kind === 'player') {
      const events = clip === 'ReceiveWand' ? { take: () => this.game.giveWand() } : {};
      return a.obj.playAction(clip, { fade: clip === 'WakeUp' ? 0 : 0.2, events });
    }
    if (a.kind === 'npc') {
      if (isLoopClip(clip)) { a.obj.setIdleClip(clip); return Promise.resolve(); }
      return a.obj.playClip(clip);
    }
    return a.obj.playScripted(clip, { ms, loop });
  }

  moveTo(actorName, to, { speed, stopDist } = {}) {
    const a = this.actor(actorName);
    const target = this.point(to);
    if (!a || !target) return Promise.resolve();
    // andar até ponto nomeado = linha reta (o gato passa pela portinhola); até um ator = pelo A*
    const ghost = typeof to === 'string' && !this.actor(to);

    if (a.kind === 'player') return a.obj.walkTo(target.x, target.z, { speed, stopDist });
    if (a.kind === 'npc') return a.obj.walkTo(target.x, target.z, { speed, stopDist });

    const cat = a.obj;
    return new Promise((resolve) => {
      let timer = 0;
      const finish = () => {
        cat.off('arrived', finish);
        cat.off('stuck', finish);
        clearTimeout(timer);
        resolve();
      };
      cat.on('arrived', finish);
      cat.on('stuck', finish);
      timer = setTimeout(finish, 25000);
      cat.walkTo(target.x, target.z, { speed, stopDist: stopDist ?? (ghost ? 0.06 : 0.3), ghost });
      if (cat.arrived) finish();
    });
  }

  lookAt(actorName, targetSpec) {
    const a = this.actor(actorName);
    const t = this.point(targetSpec);
    if (!a || !t) return;
    if (a.kind === 'player') a.obj.turnTo(t);
    else a.obj.faceTo(t.x, t.z);   // gato ou NPC
  }

  spawn(actorName, at) {
    const a = this.actor(actorName);
    const p = this.point(at);
    if (!a || !p) return;
    if (a.kind === 'npc') {
      const dx = this.game.player.pos.x - p.x, dz = this.game.player.pos.z - p.z;
      a.obj.place(p.x, p.z, yawOf(dx, dz));
      a.obj.activate(true);
      return;
    }
    if (a.kind === 'cat') {
      const cat = a.obj;
      const flap = this.point('CatFlap');
      const yaw = flap ? yawOf(flap.x - p.x, flap.z - p.z) : 0;
      cat.scripted = true;
      cat.ghost = true; // começa fora da casa: sem colisão até passar pela portinhola
      cat.place(p.x, p.z, yaw);
      cat.activate(true);
      this.game.onCatSpawned(cat);
    } else {
      a.obj.pos.set(p.x, 0, p.z);
    }
  }

  visible(actorName, v) {
    const a = this.actor(actorName);
    if (!a) return;
    if (a.kind === 'cat' || a.kind === 'npc') a.obj.setVisible(v);
    else a.obj.root.visible = v;
  }

  swing(objectName, { open = true, wobble = false } = {}) {
    const hinge = this.game.world.hinges.get(objectName);
    if (!hinge) return Promise.resolve();
    return open ? hinge.open() : hinge.close({ wobble });
  }

  lockPlayer(locked) {
    if (locked) this.game.player.lock('story'); else this.game.player.unlock('story');
  }

  /** Tomada de câmera (Story: passo `camera`). */
  camera({ shot = 'default', target, other, a, b } = {}) {
    return this.game.cameraRig.setShot(shot, { target, other, a, b });
  }

  action(name, args = {}) {
    if (name === 'peticoJoinsCompanion') {
      const cat = this.game.cats[args.actor ?? 'Petico'];
      if (cat) this.game.releaseCat(cat);
      this.game.story.setFlag('peticoBack');       // a porta de casa passa a abrir
      return Promise.resolve();
    }
    if (name === 'catsLook') {
      const p = this.point(args.at);
      if (p) for (const cat of this.game._activeCats()) cat.brain.react('look', { pos: p });
      return Promise.resolve();
    }
    if (name === 'forestObjective') {          // v0.4: novo objetivo
      this.game.ui.setObjective?.(OBJ_ENTER_FOREST);
      return Promise.resolve();
    }
    if (name === 'divonicaHome') {            // volta ao posto perto da horta e fica em Idle
      const npc = this.game.npcs.Divonica;
      const spot = this.game.outdoorWorld?.npcSpot;
      if (npc && spot) {
        npc.setIdleClip('Idle');
        npc.walkTo(spot.pos.x, spot.pos.z, { speed: 1.5, stopDist: 0.1 }).then(() => {
          const p = this.game.player.pos;
          npc.faceTo(p.x, p.z);
          setTimeout(() => npc.faceTo(null), 1200);
        });
      }
      return Promise.resolve();
    }
    console.warn(`[StoryWorld] ação desconhecida: "${name}"`);
    return Promise.resolve();
  }
}

