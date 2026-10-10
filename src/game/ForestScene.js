import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GOLD_PALETTE, PURPLE_PALETTE } from './CombatFx.js';
import { DruidBoss } from './DruidBoss.js';
import { softTexture } from './Fx.js';
import {
  FOREST, FOREST_LOOK, HINT_BRAMBLE, HINT_BRAMBLE_NO_SPELL, LINES_DRUID_FRIEND, LINE_FOREST_FIRST, LINE_STOLEN_ALL, OBJ_STOLEN,
  TOAST_CHECKPOINT, TOAST_STOLEN, TOAST_STOLEN_ALL, PROMPT_DRUID_CHAT,
} from './configForest.js';
import { clamp, easeOutBack, pick, rand, smoothstep, wait, yawOf } from './util.js';

const GREEN = [[0.7, 2.0, 0.8], [1.0, 2.2, 0.9], [0.5, 1.8, 1.2]];
const LEAF_BITS = [[0.25, 0.5, 0.3], [0.35, 0.6, 0.35], [0.4, 0.28, 0.5]];
const FLOWER_COLORS = [[2.6, 0.9, 1.6], [2.4, 1.9, 0.7], [1.0, 1.8, 2.8], [2.5, 1.2, 2.8], [0.9, 2.5, 2.0], [2.8, 1.5, 0.9]];
const _v = new THREE.Vector3();
const BLOOM_GLOW = 0.07;   // soft green wash over the bloomed clearing (additive: higher values haze the whole screen)

/** Espinheiro: mesh BRAMBLE_## + COL_Bramble_##. Alvo "tipo inimigo" só para o Broto Guardião (3 mordidas). */
class Bramble {
  constructor(forest, node, id) {
    this.forest = forest;
    this.node = node;
    this.id = id;
    this.colName = `COL_Bramble_${id}`;
    this.pos = node.getWorldPosition(new THREE.Vector3());
    const box = new THREE.Box3().setFromObject(node);
    this.radius = Math.max(1.2, (box.max.x - box.min.x) * 0.42);
    this.hp = FOREST.brambleHp;
    this.gone = false;
    this.fall = null;
    this.wob = 0;
    this.base = node.scale.clone();
  }

  get targetable() { return !this.gone && !this.fall; }
  accepts(src) { return src === 'sprout'; }
  centerWorld(out = new THREE.Vector3()) { return out.set(this.pos.x, 0.5, this.pos.z); }

  /** Mordida do Broto: chacoalha e solta pedacinhos; na última, desmonta. */
  damage(n, fromX = null, fromZ = null) {
    if (!this.targetable) return false;
    const g = this.forest.game;
    this.hp -= n;
    this.wob = 1;
    const x = this.pos.x + rand(-1.2, 1.2), z = this.pos.z + rand(-0.3, 0.3);
    g.sparkles.burst(x, 0.7, z, 14, { speed: 1.6, life: 0.7, size: 0.07, gravity: -3, palette: LEAF_BITS });
    g.sparkles.burst(x, 0.7, z, 6, { speed: 1.0, life: 0.6, size: 0.06, gravity: -1, palette: GREEN });
    g.texts.spawn('Nhac!', x, 1.2, z, { scale: 0.55 });
    if (this.hp <= 0) this.fall = { t: 0 };
    return true;
  }

  update(dt) {
    if (this.gone) return;
    const n = this.node;
    if (this.fall) {
      const f = this.fall;
      f.t += dt;
      const k = clamp(f.t / 0.9, 0, 1);
      n.scale.set(this.base.x * (1 + 0.1 * Math.sin(k * 20) * (1 - k)), this.base.y * Math.max(0.001, 1 - smoothstep(k)), this.base.z);
      n.position.y = -0.3 * smoothstep(k);
      if (Math.random() < dt * 40) this.forest.game.sparkles.burst(this.pos.x + rand(-1.8, 1.8), 0.6, this.pos.z + rand(-0.3, 0.3), 3, { speed: 1.0, life: 0.6, size: 0.07, gravity: -3, palette: LEAF_BITS });
      if (k >= 1) this._gone();
      return;
    }
    this.wob = Math.max(0, this.wob - dt * 2.2);
    n.rotation.z = Math.sin(performance.now() * 0.03) * 0.05 * this.wob;
    n.rotation.x = Math.cos(performance.now() * 0.027) * 0.03 * this.wob;
  }

  _gone() {
    const g = this.forest.game;
    this.gone = true;
    this.node.visible = false;
    this.forest.world.disableCollider(this.colName);
    g.forestNav?.rebuild();
    g.sparkles.burst(this.pos.x, 0.5, this.pos.z, 30, { speed: 2.2, life: 0.9, size: 0.08, gravity: -2, palette: GREEN });
    g.puffs?.puff(this.pos.x, 0.3, this.pos.z, { colors: ['#4a3a62', '#3a2d52'], count: 8, scale: 1.8, life: 0.7, spread: 1.2 });
    g.ui.toast?.('O Broto Guardião comeu o espinheiro! 🌿', 2200);
  }
}

/**
 * A Floresta Sombria (World02.glb): espinheiros, morangos roubados, anel de cogumelos (ponto de retorno), a arena do
 * Druida (portão, flores que brotam) e o chefe. É um "system" do Game (update(dt) só trabalha quando ativa).
 */
export class ForestScene {
  /** @param {import('./Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.world = game.forestWorld;
    this.active = false;
    this.t = 0;
    this.brambles = [];
    this.items = [];
    this.found = new Set();
    this.respawnPoint = null;
    this.arena = null;
    this.gate = null;
    this.gateAnim = null;
    this.bloom = null;
    this.hintAt = -99;
    this.fogItems = [];
    this.boss = null;
    this._setup();
  }

  // --------------------------------------------------------------------------------------------
  _setup() {
    const w = this.world;
    const g = this.game;
    // espinheiros
    for (const [name, node] of w.byName) {
      const m = /^BRAMBLE_(\d+)$/.exec(name);
      if (m) this.brambles.push(new Bramble(this, node, m[1]));
    }
    this.brambles.sort((a, b) => a.id.localeCompare(b.id));
    // morangos roubados (clones do Prop_RedStrawberry)
    const tpl = w.strawberryTemplate;
    if (tpl) {
      for (const it of w.items) {
        const node = tpl.clone(true);
        node.visible = true;
        node.position.set(it.pos.x, FOREST.hoverY, it.pos.z);
        node.rotation.set(0, Math.random() * 6, 0);
        node.scale.setScalar(1.25);
        node.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.visible = true; } });
        w.root.add(node);
        this.items.push({ id: it.id, node, x: it.pos.x, z: it.pos.z, phase: Math.random() * 6.28, got: false });
      }
    }
    // névoa roxa: discos macios e translúcidos, deitados perto do chão, à deriva
    this.fogGroup = new THREE.Group();
    this.fogGroup.name = 'FogDrift';
    const fogMats = ['#8a5cd0', '#5c88d8'].map((c) => new THREE.MeshBasicMaterial({ map: softTexture(), color: c, transparent: true, opacity: FOREST_LOOK.fogMeshOpacity, depthWrite: false }));
    const fogGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.fogItems = [];
    for (const f of w.fogPoints) {
      const m = new THREE.Mesh(fogGeo, fogMats[f.kind ? 1 : 0]);
      m.scale.set(f.size, 1, f.size);
      m.position.copy(f.pos);
      m.renderOrder = 3;
      m.rotation.y = Math.random() * 6;
      this.fogGroup.add(m);
      this.fogItems.push({ m, y: f.pos.y, ph: Math.random() * 6.28, sp: rand(0.03, 0.08) });
    }
    w.root.add(this.fogGroup);
    const spores = w.byName.get('Spores');
    if (spores) { spores.castShadow = false; this.spores = spores; }
    // arena
    const ab = w.byName.get('ARENA_Bounds');
    const c = ab ? ab.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 0, -80);
    this.arena = { x: c.x, z: c.z, radius: Number(ab?.userData?.radius) || 10, entry: Number(ab?.userData?.entry_radius) || 7.4 };
    this.gate = w.byName.get('ARENA_Gate') ?? null;
    if (this.gate) { this.gate.visible = false; }
    this.pile = w.byName.get('StrawberryPile') ?? null;
    // respawn padrão: a entrada
    const sp = w.spawns.FromVale;
    this.respawnPoint = sp ? { x: sp.pos.x, z: sp.pos.z, yaw: sp.yaw } : { x: 0, z: 2, yaw: 0 };
    // o chefe
    if (g.assets.models.druid && !g.assets.models.druid.placeholder) {
      this.boss = new DruidBoss(g, this);
      const seat = w.point('SPAWN_Boss');
      const entry = w.spawns.SPAWN_ArenaEntry;
      const seatYaw = w.spawns.Boss?.yaw ?? yawOf(this.arena.x - (seat?.x ?? 0), this.arena.z - (seat?.z ?? 0));
      if (seat) this.boss.setSeat(seat.x, seat.y, seat.z, seatYaw);
      this.boss.mount();
      void entry;
    }
  }

  get door() { return this.world.spawns.ArenaEntry ?? null; }

  // --------------------------------------------------------------------------------------------
  setActive(on) {
    const g = this.game;
    this.active = on;
    if (!on) {
      this.boss?.setVisible(false);
      this.boss?.attacks.clear();
      g.ui.setCounter?.('roubados', null);
      g.ui.hideBossBar?.();
      g.ui.clearObjective?.();
      g.cameraRig.extra = null;
      g.enemies.clear();
      return;
    }
    g.enemies.spawnFromNodes(this.world.enemyNodes.map((n) => ({ ...n, variant: FOREST.enemyVariants?.[n.id] ?? 'base' })));
    this._registerExtras();
    this.boss?.setVisible(true);
    g.ui.setCounter?.('roubados', '🍓', this.found.size, FOREST.strawberries);
    if (g.story.flags.druidDefeated) this._showDefeatedState();
    else if (this.boss && this.boss.state !== 'dormant') { this.boss.reset(); }
  }

  /** Chamado quando o fade terminou ao entrar na floresta. */
  onEntered(first) {
    const g = this.game;
    if (!g.story.flags.druidDefeated) g.ui.setObjective?.(OBJ_STOLEN, this.found.size, FOREST.strawberries);
    if (first) setTimeout(() => g.say(LINE_FOREST_FIRST, { duration: 4200 }), 700);
  }

  _registerExtras() {
    const ex = this.game.enemies.extras;
    ex.length = 0;
    for (const b of this.brambles) if (!b.gone) ex.push(b);
    if (this.boss) ex.push(this.boss);
  }

  _showDefeatedState() {
    const g = this.game;
    this._buildBloom();
    this.bloom.t = 99;
    this.bloom.on = true;
    this.bloom.glow.material.opacity = BLOOM_GLOW;
    for (const it of this.bloom.items) it.g.scale.setScalar(1);
    if (this.gate) { this.gate.visible = false; }
    this.world.disableCollider('COL_ArenaGate');
    g.forestNav?.rebuild();
    const b = this.boss;
    if (b && b.state !== 'friendly') b.makeFriendly(this.arena.x + 1.6, this.arena.z - 1.8);
    this.onBossDefeated();
    g.ui.clearObjective?.();
  }

  /** O Druida vira amigo: aparece o "Conversar". */
  onBossDefeated() {
    const w = this.world;
    if (!this.boss || w.interactables.some((i) => i.id === 'NPC_Druida')) return;
    w.interactables.push({ id: 'NPC_Druida', kind: 'druid_friend', prompt: PROMPT_DRUID_CHAT, radius: 1.3, pos: this.boss.pos, node: null, dynamic: true });
  }

  // --------------------------------------------------------------------------------------------
  // Interações
  // --------------------------------------------------------------------------------------------
  /** Anel de cogumelos: cura tudo e vira o ponto de retorno. */
  async checkpoint(item) {
    const g = this.game, p = g.player;
    await p.turnTo(item.pos);
    this.respawnPoint = { x: item.pos.x, z: item.pos.z, yaw: p.yaw };
    const missing = g.vitals.max - g.vitals.hp;
    if (missing > 0) g.vitals.heal(missing);
    g.sparkles.burst(item.pos.x, 0.4, item.pos.z, 36, { speed: 1.8, life: 1.1, size: 0.08, gravity: 0.2, palette: PURPLE_PALETTE });
    g.sparkles.burst(item.pos.x, 0.2, item.pos.z, 20, { speed: 1.2, life: 1.2, size: 0.07, gravity: 0.5, palette: GREEN });
    g.ui.toast?.(TOAST_CHECKPOINT, 2600);
    await p.playAction('Interact');
  }

  /** Volta ao Vale pela runa do começo. */
  async toVale() {
    const g = this.game;
    const gate = g.outdoorWorld?.interactables.find((i) => i.id === 'INT_Gate_Forest');
    const s = g.outdoorWorld?.spawns.FromForest;
    const spawn = s ? { pos: s.pos, yaw: s.yaw } : { pos: new THREE.Vector3((gate?.pos.x ?? -26) + 1.0, 0, gate?.pos.z ?? 0), yaw: Math.PI / 2 };
    await g.scenes.go('outdoor', { spawn });
  }

  /** Conversa com o Druida (depois da luta). */
  async druidChat() {
    const g = this.game, b = this.boss;
    if (!b) return;
    await g.player.turnTo(b.pos);
    g.cameraRig.setShot?.('closeup', { target: 'Druida', other: 'Aprendiz' });
    try {
      await g.say(pick(LINES_DRUID_FRIEND), { speaker: 'Druida', duration: 5400 });
    } finally {
      g.cameraRig.setShot?.('default');
    }
  }

  // --------------------------------------------------------------------------------------------
  // Portão da arena
  // --------------------------------------------------------------------------------------------
  closeGate() {
    const g = this.game;
    if (!this.gate) return;
    this.world.enableCollider('COL_ArenaGate');
    g.forestNav?.rebuild();
    this.gate.visible = true;
    this.gate.scale.set(1, 0.02, 1);
    this.gateAnim = { t: 0, dir: 1 };
    const gp = this.gate.getWorldPosition(new THREE.Vector3());
    g.sparkles.burst(gp.x, 0.3, gp.z, 30, { speed: 2.0, life: 0.9, size: 0.08, gravity: -1, palette: PURPLE_PALETTE });
  }

  openGate(instant = false) {
    const g = this.game;
    if (!this.gate) return;
    this.world.disableCollider('COL_ArenaGate');
    g.forestNav?.rebuild();
    if (instant) { this.gate.visible = false; this.gateAnim = null; return; }
    this.gateAnim = { t: 0, dir: -1 };
  }

  // --------------------------------------------------------------------------------------------
  // A clareira floresce
  // --------------------------------------------------------------------------------------------
  _buildBloom() {
    if (this.bloom) return;
    const w = this.world;
    const group = new THREE.Group();
    group.name = 'ArenaBloom';
    w.root.add(group);
    // flor: miolo + 5 pétalas numa malha só; haste; cogumelo brilhante
    const petals = [new THREE.SphereGeometry(0.035, 6, 4)];
    for (let i = 0; i < 5; i++) {
      const a = (i * Math.PI * 2) / 5;
      petals.push(new THREE.SphereGeometry(0.05, 6, 4).scale(1, 0.5, 1).translate(Math.cos(a) * 0.075, 0, Math.sin(a) * 0.075));
    }
    const headGeo = mergeGeometries(petals);
    const stemGeo = new THREE.CylinderGeometry(0.008, 0.012, 1, 5).translate(0, 0.5, 0);
    const capGeo = new THREE.SphereGeometry(0.1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    const mushStemGeo = new THREE.CylinderGeometry(0.02, 0.03, 0.14, 6).translate(0, 0.07, 0);
    const stemMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 0.8, 0.4), toneMapped: false });
    const mats = FLOWER_COLORS.map((c) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0], c[1], c[2]), toneMapped: false }));
    const stemW = new THREE.MeshBasicMaterial({ color: '#efe6ff' });
    const items = [];
    const seat = this.boss?.seat ?? { x: this.arena.x, z: this.arena.z - 6 };
    for (let i = 0; i < FOREST.bloomCount; i++) {
      const a = rand(0, Math.PI * 2), r = 1.0 + Math.sqrt(Math.random()) * (this.arena.radius - 1.6);
      const x = this.arena.x + Math.cos(a) * r, z = this.arena.z + Math.sin(a) * r;
      if (Math.hypot(x - seat.x, z - seat.z) < 2.3) continue;
      const grp = new THREE.Group();
      grp.position.set(x, 0, z);
      grp.rotation.y = rand(0, 6);
      const mat = pick(mats);
      if (Math.random() < 0.62) {
        const ht = rand(0.16, 0.34);
        const stem = new THREE.Mesh(stemGeo, stemMat);
        stem.scale.set(1, ht, 1);
        const head = new THREE.Mesh(headGeo, mat);
        head.position.y = ht;
        head.rotation.x = rand(-0.3, 0.3);
        grp.add(stem, head);
      } else {
        const s = rand(0.7, 1.5);
        const st = new THREE.Mesh(mushStemGeo, stemW);
        const cap = new THREE.Mesh(capGeo, mat);
        cap.position.y = 0.13;
        grp.add(st, cap);
        grp.scale.setScalar(s);
        grp.userData.s = s;
      }
      grp.userData.base = grp.scale.x;
      grp.scale.setScalar(0.001);
      group.add(grp);
      items.push({ g: grp, delay: Math.hypot(x - this.arena.x, z - this.arena.z) / 5.5 + rand(0, 0.4), done: false, base: grp.userData.base });
    }
    const glowMat = new THREE.MeshBasicMaterial({ map: softTexture(), color: new THREE.Color(0.28, 0.95, 0.62), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const glow = new THREE.Mesh(new THREE.CircleGeometry(this.arena.radius, 48).rotateX(-Math.PI / 2), glowMat);
    glow.position.set(this.arena.x, 0.04, this.arena.z);
    glow.renderOrder = 2;
    group.add(glow);
    this.bloom = { group, items, glow, t: 0, on: false, acc: 0 };
  }

  /** Brotam flores e cogumelos que brilham, do centro para fora (~3,5 s). */
  bloomArena() {
    this._buildBloom();
    this.bloom.t = 0;
    this.bloom.on = true;
    const g = this.game;
    g.sparkles.burst(this.arena.x, 0.4, this.arena.z, 60, { speed: 3.2, life: 1.4, size: 0.1, gravity: 0.2, palette: GREEN });
    return wait(3600);
  }

  // --------------------------------------------------------------------------------------------
  // Atualização
  // --------------------------------------------------------------------------------------------
  update(dt) {
    if (!this.active) return;
    dt = Math.min(dt, 0.05);
    const g = this.game;
    this.t += dt;
    for (const f of this.fogItems) { f.m.rotation.y += f.sp * dt; f.m.position.y = f.y + Math.sin(this.t * 0.5 + f.ph) * 0.07; }
    if (this.spores) this.spores.position.y = Math.sin(this.t * 0.7) * 0.12;
    for (const b of this.brambles) b.update(dt);
    this._updateItems(dt);
    this._updateGate(dt);
    this._updateBloom(dt);
    this._brambleHint();
    this.boss?.update(dt);
    // entrou na clareira: começa o encontro
    const b = this.boss, p = g.player;
    if (b && b.state === 'dormant' && !g.story.flags.druidDefeated && !p.locked && !p.defeated && !g.transitioning && g.input.enabled) {
      if (Math.hypot(p.pos.x - this.arena.x, p.pos.z - this.arena.z) < this.arena.entry) b.startIntro();
    }
  }

  _updateItems(dt) {
    const g = this.game, p = g.player;
    for (const it of this.items) {
      if (it.got) continue;
      it.node.rotation.y += dt * 1.7;
      it.node.position.y = FOREST.hoverY + Math.sin(this.t * 2.2 + it.phase) * 0.06;
      if (p.defeated || g.transitioning) continue;
      if (Math.hypot(p.pos.x - it.x, p.pos.z - it.z) < FOREST.pickupRadius) this._collect(it);
    }
  }

  _collect(it) {
    const g = this.game;
    it.got = true;
    it.node.visible = false;
    this.found.add(it.id);
    const n = this.found.size, total = FOREST.strawberries;
    g.sparkles.burst(it.x, FOREST.hoverY + 0.1, it.z, 30, { speed: 1.7, life: 0.95, size: 0.085, gravity: -0.6, palette: GOLD_PALETTE });
    g.texts.spawn('+1', it.x, FOREST.hoverY + 0.45, it.z, { scale: 0.62 });
    g.ui.setCounter?.('roubados', '🍓', n, total);
    if (!g.story.flags.druidDefeated) g.ui.setObjective?.(OBJ_STOLEN, n, total);
    const p = g.player;
    if (!p.busy && !p.locked && !p.script && !p.dodging) p.playAction('Cheer', { cancelAfter: 'hop' });
    if (n >= total) {
      g.ui.toast?.(TOAST_STOLEN_ALL, 4000);
      setTimeout(() => g.say(LINE_STOLEN_ALL, { duration: 4200 }), 700);
    } else {
      g.ui.toast?.(TOAST_STOLEN(n, total), 1800);
    }
  }

  _updateGate(dt) {
    const a = this.gateAnim;
    if (!a || !this.gate) return;
    a.t += dt;
    const k = clamp(a.t / FOREST.gateGrowTime, 0, 1);
    if (a.dir > 0) {
      this.gate.scale.set(1, Math.max(0.02, easeOutBack(k, 1.3)), 1);
      if (k >= 1) this.gateAnim = null;
    } else {
      this.gate.scale.set(1, Math.max(0.001, 1 - smoothstep(k)), 1);
      if (k >= 1) { this.gate.visible = false; this.gateAnim = null; }
    }
  }

  _updateBloom(dt) {
    const b = this.bloom;
    if (!b || !b.on) return;
    b.t += dt;
    b.glow.material.opacity = Math.min(BLOOM_GLOW, b.glow.material.opacity + dt * 0.03);
    b.acc += dt;
    for (const it of b.items) {
      if (it.done) {
        it.g.rotation.z = Math.sin(this.t * 1.3 + it.delay * 9) * 0.05;
        continue;
      }
      const k = clamp((b.t - it.delay) / 0.75, 0, 1);
      if (k <= 0) continue;
      it.g.scale.setScalar(Math.max(0.001, it.base * easeOutBack(k, 1.8)));
      if (k < 0.2 && !it.sparked) {
        it.sparked = true;
        const c = FLOWER_COLORS[(Math.random() * FLOWER_COLORS.length) | 0];
        this.game.sparkles.burst(it.g.position.x, 0.15, it.g.position.z, 5, { speed: 0.7, life: 0.8, size: 0.06, gravity: 0.4, palette: [[c[0], c[1], c[2]]] });
      }
      if (k >= 1) it.done = true;
    }
    if (b.acc > 0.18 && b.items.length) {                        // brilhinhos subindo das flores
      b.acc = 0;
      const it = b.items[(Math.random() * b.items.length) | 0];
      this.game.sparkles.emit({ x: it.g.position.x, y: 0.3, z: it.g.position.z, vx: rand(-0.08, 0.08), vy: rand(0.2, 0.5), vz: rand(-0.08, 0.08), life: rand(1.0, 1.8), size: 0.05, r: 1.6, g: 2.2, b: 1.8, gravity: 0, drag: 1 });
    }
  }

  _brambleHint() {
    const g = this.game, p = g.player;
    if (this.t - this.hintAt < 25) return;
    for (const b of this.brambles) {
      if (b.gone) continue;
      if (Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z) < b.radius + FOREST.brambleHint) {
        this.hintAt = this.t;
        g.hint?.(g.state.flags.sproutSpell ? HINT_BRAMBLE : HINT_BRAMBLE_NO_SPELL, 5000);
        return;
      }
    }
  }

  // --------------------------------------------------------------------------------------------
  /** Depois de cair na floresta: volta ao anel (ou à entrada), o chefe reinicia, os Sombritos renascem. */
  async respawn() {
    const g = this.game;
    const b = this.boss;
    if (b && b.state !== 'friendly' && b.state !== 'dormant') b.reset();
    g.enemies.spawnFromNodes(this.world.enemyNodes.map((n) => ({ ...n, variant: FOREST.enemyVariants?.[n.id] ?? 'base' })));
    this._registerExtras();
    const r = this.respawnPoint;
    g.player.teleport(r.x, r.z, r.yaw);
    let i = 0;
    for (const cat of g._activeCats()) {
      const f = g.nav.nearestFree(r.x + (i++ % 2 ? 0.8 : -0.8), r.z - 0.9, 1.5) ?? { x: r.x, z: r.z };
      cat.teleport(f.x, f.z, r.yaw);
    }
    g.cameraRig.extra = null;
    g.cameraRig.snapTo(g.player.pos);
    if (!g.story.flags.druidDefeated) g.ui.setObjective?.(OBJ_STOLEN, this.found.size, FOREST.strawberries);
  }
}
