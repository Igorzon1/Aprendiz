import * as THREE from 'three';
import { Cat } from './Cat.js';
import { CatBrain, updateHeading } from './CatBrain.js';
import { CameraRig } from './CameraRig.js';
import { Collision } from './Collision.js';
import { Combat } from './Combat.js';
import { Enemies } from './Enemies.js';
import { Npc } from './Npc.js';
import { OutdoorWorld } from './OutdoorWorld.js';
import { PlayerVitals } from './PlayerVitals.js';
import { SceneManager } from './SceneManager.js';
import { Strawberries } from './Strawberries.js';
import { CAT, RENDER } from './config.js';
import { DIVONICA } from './configWorld.js';
import { Input } from './Input.js';
import { Interaction } from './Interaction.js';
import { Nav } from './Nav.js';
import { FloatingTexts, PointerMarker, Sparkles } from './Particles.js';
import { Player } from './Player.js';
import { Postfx } from './Postfx.js';
import {
  applyWandVisibility, createGameState, createWandGate, findWandMeshes, giveWand, installDevWandShortcut,
} from './Progression.js';
import { HINT_CONTROLS, HINT_CONTROLS_WAND, Story } from './Story.js';
import { StoryWorld } from './StoryWorld.js';
import { World } from './World.js';

const _v = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _ray = new THREE.Raycaster();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5);
const _hit = new THREE.Vector3();

/** Orquestra os sistemas: criação da cena, loop, ligações entre jogador, gatos, mundo, UI e história. */
export class Game {
  /**
   * @param {{container:HTMLElement, ui:object, assets:import('./Assets.js').Assets}} o
   */
  constructor({ container, ui, assets }) {
    this.container = container;
    this.ui = ui;
    this.assets = assets;
    this._last = 0;
    this.running = false;
    this.started = false;
    this.paused = false;
    this._shelfOpen = false;

    // --- renderer
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; // trocar por THREE.AgXToneMapping se preferir mais suave
    renderer.toneMappingExposure = RENDER.exposure;
    renderer.shadowMap.enabled = true;
    // r186: PCFSoftShadowMap foi removido; PCFShadowMap já é filtrado (suave) e respeita shadow.radius.
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(RENDER.background);
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);
    this.cameraRig = new CameraRig(this.camera);
    this.postfx = new Postfx(renderer, this.scene, this.camera);
    this.sparkles = new Sparkles(this.scene);
    this.texts = new FloatingTexts(this.scene);
    this.marker = new PointerMarker(this.scene);

    this.input = new Input(window);
    this.state = createGameState();
    this.speakAt = null;
    this._sayToken = 0;
    this._bubbleShown = false;
    this.cats = {};
    this.systems = [];        // plug-in systems with update(dt) (camera shots, AFK play, enemies, pickups...)

    this._build();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  // --------------------------------------------------------------------------------------------
  // Construção
  // --------------------------------------------------------------------------------------------
  _build() {
    const { models } = this.assets;

    // Mundo + colisão + navegação. `collision` e `nav` são "mestres": adotam os do cenário ativo (SceneManager).
    const navOpts = { radius: CAT.navRadius, height: CAT.height };
    this.houseCollision = new Collision();
    this.houseWorld = this.world = new World(this.scene, models.house, this.houseCollision);
    this.houseNav = new Nav(this.houseCollision, this.houseWorld.bounds, navOpts);
    this.collision = new Collision();
    this.collision.adopt(this.houseCollision);
    this.cameraRig.setBounds(this.world.bounds);
    this.nav = new Nav(this.houseCollision, this.houseWorld.bounds, navOpts);

    // v0.2: o Vale dos Morangos (some se o World01.glb não existir)
    this.outdoorWorld = null;
    if (!models.world.placeholder && models.world.scene) {
      this.outdoorCollision = new Collision();
      this.outdoorWorld = new OutdoorWorld(this.scene, models.world, this.outdoorCollision);
      this.outdoorWorld.setActive(false);
      this.outdoorNav = new Nav(this.outdoorCollision, this.outdoorWorld.bounds, navOpts);
      this.outdoorWorld.on('area', (a) => this.ui.showAreaTitle?.(a.title, a.subtitle));
    }
    this.transitioning = false;

    // Aprendiz
    this.player = new Player({ asset: models.apprentice, collision: this.collision, input: this.input, cameraRig: this.cameraRig });
    this.scene.add(this.player.root);
    const sp = this.world.spawns.Player ?? this._fallbackSpawn(0);
    this.player.spawn(sp.pos.x, sp.pos.z, sp.yaw);
    this.player.on('attackRelease', () => this._onAttackRelease());
    this.player.on('afk', (afk) => { this.afk = afk; });
    this.player.hasWand = () => this.state.flags.hasWand;

    // Gatos (Petico só aparece na história: entra pela portinhola)
    const heading = { angle: this.player.yaw };
    this.heading = heading;
    const playerProxy = { pos: this.player.pos, isPlayer: true };
    for (const name of ['Yumi', 'Petico']) {
      const cat = new Cat({ name, asset: models[name.toLowerCase()], collision: this.collision, nav: this.nav });
      cat.neighbors = () => [playerProxy, ...Object.values(this.cats).filter((c) => c !== cat && c.active)];
      this.scene.add(cat.root);
      this.cats[name] = cat;
      cat.brain = new CatBrain(cat, { player: this.player, others: () => Object.values(this.cats), nav: this.nav, heading });
      cat.brain.setThreats(() => (this.enemies ? this.enemies.threatPositions() : null));
    }
    // brincadeira do AFK: os gatos perseguem o brinquedo (sem varinha) ou o brilho (com varinha)
    for (const cat of Object.values(this.cats)) {
      const v = new THREE.Vector3();
      cat.brain.setPlayTarget(() => this.player.afkTargetWorld(v));
    }
    const ys = this.world.spawns.Yumi ?? this._fallbackSpawn(1);
    this.cats.Yumi.place(ys.pos.x, ys.pos.z, ys.yaw);
    this.cats.Yumi.activate(true);
    const ps = this.world.spawns.PeticoReturn ?? this.world.spawns.Petico ?? this._fallbackSpawn(-1);
    this.cats.Petico.place(ps.pos.x, ps.pos.z, ps.yaw);
    this.cats.Petico.scripted = true; // não existe até a cutscene do retorno

    // Combate, interação, história
    this.combat = new Combat({ scene: this.scene, world: this.world, collision: this.collision, sparkles: this.sparkles, texts: this.texts });
    this.combat.on('dummyHit', (d) => this._onDummyHit(d));
    this.vitals = new PlayerVitals(this);
    this.enemies = new Enemies(this);
    this.enemies.vitals = this.vitals;
    this.enemies.load();
    this.combat.setEnemies(this.enemies);
    this.strawberries = new Strawberries(this);
    this.npcs = {};
    if (models.divonica && models.divonica.scene) {
      const npc = new Npc({ name: 'Divonica', asset: models.divonica, collision: this.collision });
      npc.setIdleClip('Idle');
      npc.activate(false);
      this.scene.add(npc.root);
      this.npcs.Divonica = npc;
    }
    this.interaction = new Interaction(this);
    this.sayUI = { say: (text, opts) => this.say(text, opts) }; // Progression usa este "ui" para o balão seguir a Aprendiz
    this.story = new Story(new StoryWorld(this));
    this.scenes = new SceneManager(this);
    this.scenes.on('entered', (name, first) => this._onSceneEntered(name, first));

    // Varinha: começa sem (v0.1). ?wand=1 ou F2 em dev liga.
    this.wands = findWandMeshes(this.player.model);
    applyWandVisibility(this.state, this.wands);
    this.wandGate = createWandGate(this.state, this.sayUI);
    this.player.canCast = () => this.wandGate.canCast();
    installDevWandShortcut(this.state, this.wands, (on) => this.ui.showHint(on ? 'Varinha ligada (F2)' : 'Varinha desligada (F2)', 2000));

    if (this.world.fridge) {
      this.world.fridge.on('opening', () => this._onFridgeOpening());
      this.world.fridge.on('closing', () => this.marker.hide());
    }

    if (this.outdoorWorld) {
      this.strawberries.setup(this.outdoorWorld);
      // Divonica fica em NPC_Divonica; interativo dinâmico "Conversar" (acompanha a posição dela)
      const npc = this.npcs.Divonica;
      if (npc) {
        this.outdoorWorld.interactables.push({ id: 'NPC_Divonica', kind: 'npc', prompt: 'Conversar', radius: DIVONICA.talkRadius, pos: npc.pos, node: null, dynamic: true });
        npc.place(this.outdoorWorld.npcSpot?.pos.x ?? 8.9, this.outdoorWorld.npcSpot?.pos.z ?? -15.5, this.outdoorWorld.npcSpot?.yaw ?? 0);
      }
    }
    this.cameraRig.resolveActor = (spec) => this._cameraActor(spec);
    this._setHouseOccluders();
    this.cameraRig.snapTo(this.player.pos);
    if (new URLSearchParams(location.search).get('scene') === 'outdoor' && this.outdoorWorld) {
      this.story.flags.peticoBack = true;
      this.scenes.apply('outdoor');
    }

    // Pausa: Esc alterna o painel da UI (ignorado antes de começar e com a estante aberta).
    // O painel também avisa por 'pause' (ex.: botão "Continuar"), e a estante por 'bookshelf'.
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || e.repeat || !this.started || this._shelfOpen) return;
      this.paused = this.ui.togglePause?.() ?? false;
      if (this.paused) this.input.clear();
    });
    window.addEventListener('pause', (e) => { this.paused = !!e.detail?.open; });
    window.addEventListener('bookshelf', (e) => { this._shelfOpen = !!e.detail?.open; });
  }

  /** Atores para a câmera (setShot): nome ('Aprendiz', 'Yumi', 'Divonica'...) -> {pos, yaw, kind}. */
  _cameraActor(spec) {
    if (spec === 'Aprendiz' || spec === 'player') return { pos: this.player.pos, yaw: this.player.yaw, kind: 'apprentice' };
    const cat = this.cats[spec];
    if (cat) return { pos: cat.pos, yaw: cat.yaw, kind: 'cat' };
    const npc = this.npcs?.[spec];
    if (npc) return { pos: npc.pos, yaw: npc.yaw, kind: 'apprentice' };
    const p = this.world.point(spec);
    return p ? { pos: p, yaw: 0, kind: 'apprentice' } : null;
  }

  /** Paredes da casa que somem quando tapam a visão (userData.wall: Back/Left/Right + Door/CatFlap com Left). */
  _setHouseOccluders() {
    const list = [];
    this.world.root.traverse((o) => { if (o.userData?.wall || /^Wall_(Back|Left|Right|Front)$/.test(o.name)) list.push(o); });
    this.cameraRig.setSceneMode({ indoor: true });
    this.cameraRig.setOccluders(list);
  }

  /** Register a system updated every frame (after the player/cats, before interaction). Returns it. */
  addSystem(system) {
    this.systems.push(system);
    return system;
  }

  removeSystem(system) {
    this.systems = this.systems.filter((s) => s !== system);
  }

  _fallbackSpawn(i) {
    const b = this.world.bounds;
    return { pos: new THREE.Vector3((b.minX + b.maxX) / 2 + i * 0.7, 0, (b.minZ + b.maxZ) / 2), yaw: 0 };
  }

  // --------------------------------------------------------------------------------------------
  // Fluxo do jogo
  // --------------------------------------------------------------------------------------------
  /** Chamado depois do título: libera os controles e roda a abertura da história. */
  beginPlay() {
    if (this.started) return;
    this.started = true;
    this.input.clear();
    this.input.enabled = true;
    const q = new URLSearchParams(location.search);
    if (q.get('skip') === '1' || q.get('scene') === 'outdoor') this._devSkip(q);
    else this.story.play('opening');
    if (this.scenes.current === 'outdoor') this._onSceneEntered('outdoor', !this.story.flags['done:divonicaMeet']);
  }

  /** Parâmetros de desenvolvimento: ?skip=1 (sem a abertura) e ?scene=outdoor (já começa lá fora). */
  _devSkip(q) {
    const f = this.story.flags;
    f['done:opening'] = true;
    f.fridgeOpened = true;
    f['done:fridgeDream'] = true;
    f['done:peticoReturn'] = true;
    f.peticoBack = true;
    this.ui.fade(0, 400);
    const petico = this.cats.Petico;
    const y = this.cats.Yumi;
    petico.place(y.pos.x + 0.6, y.pos.z + 0.4, y.yaw);
    petico.scripted = false;
    petico.activate(true);
    petico.brain.mode = 'free';
    if (q.get('wand') === '1') this.state.flags.hasWand = true;
  }

  /** Terminou de entrar num cenário (depois do fade). */
  _onSceneEntered(name, first) {
    if (name !== 'outdoor') return;
    if (first && !this.story.flags['done:divonicaMeet'] && this.npcs.Divonica) this.story.play('divonicaMeet');
  }

  /** Depois de cair: volta à porta de casa (por fora), com vida cheia e os Sombritos de volta aos seus lugares. */
  async respawnAfterDefeat() {
    this.player.revive();
    this.transitioning = true;
    const sp = this.outdoorWorld?.spawns.FromHouse;
    if (this.scenes.current !== 'outdoor') this.scenes.apply('outdoor');
    else if (sp) {
      this.enemies.spawnFromNodes(this.outdoorWorld.enemyNodes);
      this.player.teleport(sp.pos.x, sp.pos.z, sp.yaw);
      for (const [name, cat] of Object.entries(this.cats)) {
        if (!cat.active || cat.scripted) continue;
        const s = this.outdoorWorld.spawns[`${name}_Out`];
        if (s) cat.teleport(s.pos.x, s.pos.z, s.yaw);
      }
      this.cameraRig.snapTo(this.player.pos);
    }
    this.transitioning = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._last = performance.now();
    this.renderer.setAnimationLoop(() => this._frame());
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  _frame() {
    const now = performance.now();
    const dt = Math.min((now - this._last) / 1000, 0.05);
    this._last = now;
    this.update(dt);
    if (this.hasSize) this.postfx.render(dt);
  }

  update(dt) {
    const input = this.input;

    if (this.paused) { // parado: descarta entradas de um quadro (zoom, E/Espaço) para não dispararem ao despausar
      input.consumeWheel();
      input.endFrame();
      return;
    }

    // câmera: roda = zoom, botão direito = órbita, C = close
    const wheel = input.consumeWheel();
    if (wheel) this.cameraRig.addZoom(wheel);
    if (input.rightDown || input.orbit.x || input.orbit.y) {
      const o = input.consumeOrbit();
      this.cameraRig.addOrbit(o.x, o.y);
    }
    if (input.enabled && input.wasPressed('KeyC')) this.cameraRig.toggleCloseup();

    // ataque básico (Espaço, J, clique): só se a história/interação deixar
    if (input.attackHeld && this.player.attackCooldown <= 0) {
      let aim = null;
      if (input.attackSource === 'mouse' && input.pointer.inside) aim = this._groundPoint(input.pointer);
      this.player.tryAttack(aim);
    }

    this.player.update(dt);
    updateHeading(this.heading, this.player, dt);

    for (const cat of Object.values(this.cats)) {
      if (!cat.active) continue;
      if (!cat.scripted) cat.brain.update(dt);
      cat.update(dt);
    }

    this.world.update(dt, this.player.pos, this.player.pos);
    if (this.scenes.current === 'outdoor') this.enemies.update(dt);
    for (const npc of Object.values(this.npcs)) npc.update(dt);
    this.vitals.update(dt);
    this.strawberries.update(dt);
    this.combat.update(dt);
    this.sparkles.update(dt);
    this.texts.update(dt);
    this.marker.update(dt);
    for (const s of this.systems) s.update?.(dt);
    this.interaction.update();

    this.cameraRig.update(dt, this.player.pos, { x: this.player.vx, z: this.player.vz });
    this._updateBubble();
    input.endFrame();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.hasSize = w > 1 && h > 1; // janela minimizada/oculta: não redimensiona nem renderiza
    if (!this.hasSize) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.postfx.setSize(w, h);
    this.cameraRig.setAspect(w / Math.max(1, h));
    this.sparkles.setViewport(this.renderer.getDrawingBufferSize(new THREE.Vector2()).y, this.camera.fov);
  }

  /** Ponto do chão (plano y=0.5) sob o ponteiro do mouse. */
  _groundPoint(pointer) {
    _ray.setFromCamera(pointer, this.camera);
    return _ray.ray.intersectPlane(_plane, _hit) ? { x: _hit.x, z: _hit.z } : null;
  }

  // --------------------------------------------------------------------------------------------
  // Fala, dicas, balão
  // --------------------------------------------------------------------------------------------
  /**
   * Balão de fala que segue o falante (ou o ponto `at`). Retorna a Promise do ui.say.
   * @param {string} text
   * @param {{speaker?:string, duration?:number, at?:string}} [o]
   */
  say(text, { speaker = 'Aprendiz', duration, at = null } = {}) {
    const token = ++this._sayToken;
    this.speakAt = at ? this._anchorFor(at) : (speaker !== 'Aprendiz' ? this._anchorFor(speaker) : null);
    const p = this.ui.say(text, { duration, speaker });
    p.then(() => { if (token === this._sayToken) this.speakAt = null; });
    return p;
  }

  /** Função (out)=>Vector3 com o ponto de mundo onde a cauda do balão deve cair. */
  _anchorFor(spec) {
    if (spec === 'Aprendiz' || spec === 'player') return null;
    const cat = this.cats[spec];
    if (cat) return (out) => out.set(cat.pos.x, cat.pos.y + 0.33, cat.pos.z);
    const npc = this.npcs?.[spec];
    if (npc) return (out) => npc.headWorld(out).y += 0.4;
    const named = this.world.point(spec);
    if (named) return (out) => out.copy(named).addScaledVector(_up, 0.35);
    return null;
  }

  /** Posição do balão em pixels, a cada quadro (contrato: ui.setBubbleAnchor). */
  _updateBubble() {
    const out = _v;
    if (this.speakAt) this.speakAt(out);
    else this.player.headWorld(out).y += 0.45;
    out.project(this.camera);
    const x = (out.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-out.y * 0.5 + 0.5) * window.innerHeight;
    this.ui.setBubbleAnchor(x, y, out.z < 1);
  }

  /** Dica no rodapé; com `at`, uma setinha dourada balança sobre o ponto indicado. */
  hint(text, ms = 4000, at = null) {
    if (text === HINT_CONTROLS && this.state.flags.hasWand) text = HINT_CONTROLS_WAND;
    this.ui.showHint(text, ms);
    if (at) {
      const target = this._markerTarget(at);
      if (target) this.marker.show(target, ms / 1000);
    }
  }

  _markerTarget(name) {
    const f = this.world.fridge;
    if (name === 'Fridge_Door' && f) {
      // seta flutuando na frente da parte de cima da geladeira (do lado da Aprendiz)
      const top = new THREE.Box3().setFromObject(f.door).max.y;
      const toP = new THREE.Vector3(this.player.pos.x - f.center.x, 0, this.player.pos.z - f.center.z);
      if (toP.lengthSq() < 1e-4) toP.set(0, 0, 1);
      toP.normalize();
      const p = new THREE.Vector3(f.center.x, top + 0.05, f.center.z).addScaledVector(toP, 0.55);
      return () => p;
    }
    const pt = this.world.point(name);
    if (!pt) return null;
    const p = pt.clone().add(new THREE.Vector3(0, 0.6, 0));
    return () => p;
  }

  // --------------------------------------------------------------------------------------------
  // Reações do mundo
  // --------------------------------------------------------------------------------------------
  _activeCats() { return Object.values(this.cats).filter((c) => c.active && !c.scripted); }

  _onAttackRelease() {
    const origin = this.player.wandTipWorld(new THREE.Vector3());
    const dir = this.player.forward(new THREE.Vector3());
    this.combat.fire(origin, dir, { mouse: this.input.attackSource === 'mouse' });
    // gato muito perto leva um susto
    for (const cat of this._activeCats()) {
      if (cat.distTo(this.player.pos.x, this.player.pos.z) < 1.1) cat.brain.react('startle', { from: this.player.pos });
    }
  }

  _onDummyHit(dummy) {
    for (const cat of this._activeCats()) cat.brain.react('look', { pos: dummy.center });
  }

  /** A porta da geladeira começou a abrir: faíscas nos morangos e os gatos correm para lá. */
  _onFridgeOpening() {
    const f = this.world.fridge;
    this.marker.hide();
    // faíscas nos morangos
    const bp = f.berries ? new THREE.Box3().setFromObject(f.berries).getCenter(new THREE.Vector3()) : f.center;
    this.sparkles.burst(bp.x, bp.y, bp.z, 24, { speed: 1.2, life: 1.0, size: 0.07, gravity: -0.3 });

    // pontos de parada em frente à geladeira, um de cada lado da Aprendiz
    const toP = new THREE.Vector3(this.player.pos.x - f.center.x, 0, this.player.pos.z - f.center.z);
    if (toP.lengthSq() < 1e-4) toP.set(0, 0, 1);
    toP.normalize();
    const perp = new THREE.Vector3(-toP.z, 0, toP.x);
    const base = new THREE.Vector3(f.center.x, 0, f.center.z).addScaledVector(toP, 0.8);
    const spots = {};
    const names = Object.keys(this.cats);
    names.forEach((name, i) => {
      const side = i % 2 === 0 ? 1 : -1;
      const x = base.x + perp.x * 0.5 * side, z = base.z + perp.z * 0.5 * side;
      spots[name] = this.nav.nearestFree(x, z, 1) ?? { x, z };
    });
    for (const cat of this._activeCats()) cat.brain.react('fridge', { pos: { x: f.center.x, z: f.center.z }, spots });
  }

  /** O Petico acabou de aparecer (cutscene): a câmera passa a incluí-lo, e a Yumi olha para lá. */
  onCatSpawned(cat) {
    this.cameraRig.extra = () => (cat.active ? cat.pos : null);
    const yumi = this.cats.Yumi;
    if (yumi && cat !== yumi) yumi.brain.react('look', { pos: cat.pos });
  }

  /** Devolve o gato ao cérebro (ele passa a acompanhar a Aprendiz como companheiro). */
  releaseCat(cat) {
    const wait = Math.max(0, cat.scriptUntil - performance.now());
    setTimeout(() => {
      cat.scripted = false;
      cat.scriptUntil = 0;
      cat.ghost = false;
      cat.faceTo(null);
      cat.setIdleClip('Idle');
      cat.curLoco = null;
      cat.brain.task = null;
      cat.brain.mode = 'free';
      this.cameraRig.extra = null;
    }, wait);
  }

  /** v0.2: a menina da rua entrega a varinha. */
  giveWand() {
    return giveWand(this.state, this.wands, { scene: this.scene });
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
  }
}

