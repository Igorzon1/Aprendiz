import * as THREE from 'three';
import { TRANSITION } from './configWorld.js';
import { Emitter, wait } from './util.js';

/**
 * Cenários do jogo: 'house' (interior, câmera dollhouse) e 'outdoor' (Vale dos Morangos).
 * Cada cenário tem seus próprios colisores, grade de navegação, luzes e interativos; o Game guarda um
 * Collision/Nav "mestre" que ADOTA os do cenário ativo (assim Player/Gatos/Inimigos nunca trocam de referência).
 * Troca com fade (porta da casa <-> porta de fora); os gatos vão junto.
 * Evento: 'entered' (name, first).
 */
export class SceneManager extends Emitter {
  /** @param {import('./Game.js').Game} game */
  constructor(game) {
    super();
    this.game = game;
    this.current = 'house';
    this.visited = new Set(['house']);
    this.busy = false;
  }

  get outdoorAvailable() { return !!this.game.outdoorWorld; }

  worldOf(name) { return name === 'outdoor' ? this.game.outdoorWorld : this.game.houseWorld; }

  /** Pode sair de casa? (o Petico precisa ter voltado) */
  get canLeave() { return this.outdoorAvailable && !!this.game.story.flags.peticoBack; }

  /** Troca de cenário com fade. Resolve quando a tela clareou de novo. */
  async go(name, { spawn = null } = {}) {
    const g = this.game;
    if (this.busy || name === this.current || !this.worldOf(name)) return;
    this.busy = true;
    g.transitioning = true;
    g.input.clear();
    g.player.lock('transition');
    try {
      await g.ui.fade(1, TRANSITION.fadeOut);
      await wait(TRANSITION.hold);
      this.apply(name, spawn);
      await wait(60);
      g.ui.fade(0, TRANSITION.fadeIn);
      await wait(Math.min(TRANSITION.fadeIn, 400));
    } finally {
      g.player.unlock('transition');
      g.transitioning = false;
      this.busy = false;
    }
    const first = !this.visited.has(name);
    this.visited.add(name);
    this.emit('entered', name, first);
  }

  /** Aplica o cenário na hora (sem fade): usado pela troca e pelos parâmetros de desenvolvimento. */
  apply(name, spawnOverride = null) {
    const g = this.game;
    const next = this.worldOf(name);
    const prev = this.worldOf(this.current);
    const out = name === 'outdoor';

    if (prev && prev !== next) prev.setActive(false);
    next.setActive(true);
    this.current = name;
    g.world = next;
    g.collision.adopt(next.collision);
    g.nav.adopt(out ? g.outdoorNav : g.houseNav);
    g.combat.world = next;

    // visual do cenário
    const look = next.look;
    g.scene.background = new THREE.Color(look.background);
    g.scene.fog = look.fog ? new THREE.Fog(look.fog.color, look.fog.near, look.fog.far) : null;

    // câmera
    g.cameraRig.setBounds(next.bounds);
    if (out) { g.cameraRig.setSceneMode({ indoor: false }); g.cameraRig.setOccluders([]); } else g._setHouseOccluders();

    // inimigos, morangos, Divonica só ao ar livre
    g.enemies.clear();
    if (out) g.enemies.spawnFromNodes(next.enemyNodes);
    g.strawberries.setActive(out);
    for (const npc of Object.values(g.npcs)) npc.setVisible(out);
    if (out) next.area = null;

    // posições: Aprendiz e gatos
    const sp = spawnOverride ?? (out ? next.spawns.FromHouse : this._houseDoorSpawn(next));
    g.player.teleport(sp.pos.x, sp.pos.z, sp.yaw);
    this._placeCats(next, sp, out);
    g.cameraRig.snapTo(g.player.pos);
    g.input.clear();
  }

  /** Dentro de casa: logo depois da porta, olhando para dentro. */
  _houseDoorSpawn(house) {
    const d = house.interactables.find((i) => i.kind === 'door');
    const x = d ? d.pos.x + 0.45 : -2.5, z = d ? d.pos.z : 1.35;
    return { pos: new THREE.Vector3(x, 0, z), yaw: Math.PI / 2 };
  }

  _placeCats(world, sp, out) {
    const g = this.game;
    const nav = g.nav;
    const spots = out
      ? { Yumi: world.spawns.Yumi_Out, Petico: world.spawns.Petico_Out }
      : { Yumi: { pos: { x: sp.pos.x + 0.3, z: sp.pos.z + 0.75 }, yaw: sp.yaw }, Petico: { pos: { x: sp.pos.x + 0.3, z: sp.pos.z - 0.75 }, yaw: sp.yaw } };
    for (const [name, cat] of Object.entries(g.cats)) {
      if (!cat.active || cat.scripted) continue;
      const s = spots[name];
      if (!s) continue;
      const f = nav.nearestFree(s.pos.x, s.pos.z, 1.5) ?? { x: s.pos.x, z: s.pos.z };
      cat.teleport(f.x, f.z, s.yaw);
    }
  }
}
