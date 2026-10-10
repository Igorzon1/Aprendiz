import * as THREE from 'three';
import { GOLD_PALETTE } from './CombatFx.js';
import { clamp, damp, dampAngle, easeOutBack, pick, smoothstep, yawOf } from './util.js';

// =============================================================================================
// v0.3: Horta Mágica. Lê os nós do World01.glb (GPlant_##, GPlant_##_Dry/_Leaves/_Berries, WateringCan, GardenBook,
// Prop_RedBerry, INT_GardenBook, INT_WateringCan) e roda o mini game:
//   fase 1 'water': levitar o regador e regar os 6 pés murchos (segurar Espaço em cima de cada um);
//   fase 2 'grow' : segurar Espaço perto de um pé regado, o medidor enche pulsando, soltar na faixa verde;
//   recompensa    : flags.sproutSpell = true (tecla Q: GuardianSprout.js).
// É um "system" do Game (update(dt)); as interações chegam por interact(item) (Interaction.js).
// =============================================================================================

// ---- ajustes ----------------------------------------------------------------------------------
export const GARDEN = {
  total: 6,
  // regador
  liftAt: 0.75,           // s depois do início de Cast_Levitate em que o regador sai do chão
  freeAt: 1.5,            // s: a partir daqui andar cancela o resto do clip
  follow: { fwd: 0.8, side: 0.14, y: 1.0 },
  spring: { k: 55, c: 11 },
  bob: { amp: 0.035, hz: 2.4 },
  hoverY: 0.62,           // altura do bico (rosa) acima da base do pé quando rega
  tilt: 0.62,             // rad: inclinação do regador ao regar
  // rega
  waterTime: 1.0,         // s de rega até o pé reviver
  waterPick: 1.15,        // m: raio, ao redor do ponto à frente dela, para escolher o pé
  waterReach: 1.9,        // m: distância máxima entre ela e o pé
  dropsPerSec: 46,
  // crescer
  growReach: 1.35,        // m: distância máxima até o pé regado
  fillTime: 2.2,          // s para o medidor ir de 0 a 1
  zone: [0.58, 0.8],      // faixa verde (varia um pouco a cada tentativa)
  overflow: 0.4,          // s a mais depois de encher até soltar sozinho (tarde demais)
  holdAt: 1.0,            // s do clip Cast_Lumos em que a pose congela enquanto canaliza
  leafPop: 1.28,          // overshoot da folhagem ao crescer
  leafFinal: 1.12,
  giantScale: 3.4,
  celebrateAfter: 1.1,    // s depois do último pé até o desbloqueio
};

const MORE_SPARKS = { speed: 1.5, life: 0.9, size: 0.07, gravity: -0.6 };
const WATER_PALETTE = [[0.6, 1.7, 2.6], [1.0, 2.0, 2.8], [0.5, 1.4, 2.2]];
const GROW_PALETTE = [[0.7, 2.2, 0.9], [1.4, 2.4, 0.8], [2.2, 2.2, 1.0], [1.0, 2.4, 1.6]];

// ---- textos -------------------------------------------------------------------------------------
const OBJ_WATER = 'Regue os morangos';
const OBJ_GROW = 'Faça os morangos crescerem';
const LINE_BOOK_NO_WAND = 'Um grimório aberto! Mas sem a varinha eu só consigo olhar as figuras. Elas são bem bonitas, pelo menos.';
const LESSON_LINES = [
  'Grimório da Horta, volume um: "Como regar sem sujar as mãos".',
  'Lição um: levite o regador. Ele é azul, redondo e muito sensível. Trate com educação.',
  'Lição dois: segure a varinha sobre cada pé murcho. Os seis estão... dramáticos.',
  'Lição três: depois da água, só falta incentivar. Com magia. E sem gritar.',
  'Nota de rodapé: "O regador NÃO é um chapéu. Já testamos." Anotado.',
];
const BOOK_AGAIN_WATER = [
  'Lição dois: com o regador flutuando, segure Espaço em cima de cada pé murcho. Pacientemente.',
  'O livro repete: regador, Espaço, pé murcho. Ele não é de enrolar.',
];
const BOOK_AGAIN_GROW = [
  'Lição três: perto de um pé regado, segure Espaço e solte quando o medidor estiver na faixa verde.',
  'Segurar demais faz o morango crescer demais. O livro avisa em letras miúdas.',
];
const BOOK_DONE = [
  'O livro diz: "Parabéns, jardineira. Agora lave as mãos." Boa ideia.',
  'Última página: um desenho de um broto com dentes. Parece simpático. Mais ou menos.',
];
const CAN_NO_WAND = 'Sem a varinha, o regador vai continuar no chão. Ele é teimoso.';
const CAN_BEFORE_BOOK = 'Um regador azul bem simpático. Aposto que o livro, ali no portão, sabe o que fazer com ele.';
const CAN_LIFT = ['Sobe, sobe, regadorzinho!', 'Vai, regador! Sem derramar na minha cabeça, por favor.', 'Levita, levita... isso, bonitão.'];
const CAN_USED = ['O regador já cumpriu a missão de hoje. Merece um descanso.', 'Deixa ele descansar. Foi um dia de muita água.'];
const LINE_WATER_DONE = 'Seis pés molhadinhos! Agora o incentivo mágico: segurar Espaço perto de um deles.';
const HINT_GROW = 'Segure Espaço perto de um pé regado e solte na faixa verde';
const LINES_GROW_OK = ['Isso! Flores e morangos!', 'Que lindeza de pé de morango!', 'Cresceu direitinho. Sou boa nisso!'];
const LINES_EARLY = ['Ainda faltou um tiquinho...', 'Cedo demais! Ele só espreguiçou.', 'Quase! Respira e tenta de novo.'];
const LINES_GIANT = [
  'Eu pedi um morango. Isso é um morango? Isso é um capacete!',
  'Ops. Exagerei no incentivo.',
  'Esse morango tem mais personalidade do que eu.',
  'Dá para alimentar a vila inteira. E os gatos também, se eles deixarem.',
];
const LINES_DONE = [
  'Seis pés de morango felizes. E um feitiço novo no bolso!',
  'Broto Guardião! Uma plantinha com muitos dentes... e zero boas maneiras.',
  'Vou plantar uns amigos por aí. Os Sombritos vão adorar. Ou não.',
];
const UNLOCK_TITLE = 'Broto Guardião';
const UNLOCK_SUB = 'Aperte Q para plantar um guardião';

const _f = new THREE.Vector3();
const _p = new THREE.Vector3();
const _w = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Euler();

// ---- gotinhas de água (um único InstancedMesh) -------------------------------------------------------
class Drops {
  constructor(parent, capacity = 100) {
    this.cap = capacity;
    this.items = [];
    this.mesh = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.02, 6, 5),
      new THREE.MeshBasicMaterial({ color: 0x8fd8ff, transparent: true, opacity: 0.92, toneMapped: false }),
      capacity,
    );
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 9;
    parent.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._s = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  spawn(x, y, z, vx, vy, vz) {
    if (this.items.length >= this.cap) this.items.shift();
    this.items.push({ x, y, z, vx, vy, vz, life: 1.2, s: 0.7 + Math.random() * 0.7 });
  }

  /** onLand(x, y, z) é chamado quando uma gota bate no chão / na terra. */
  update(dt, floorAt, onLand) {
    let n = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const d = this.items[i];
      d.vy -= 9.8 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      d.life -= dt;
      if (d.life <= 0 || d.y <= floorAt(d.x, d.z)) {
        if (d.life > 0) onLand?.(d.x, d.y, d.z);
        this.items.splice(i, 1);
      }
    }
    for (const d of this.items) {
      this._s.set(d.s, d.s * 1.7, d.s);
      this._m.compose(_w.set(d.x, d.y, d.z), this._q, this._s);
      this.mesh.setMatrixAt(n++, this._m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() { this.items.length = 0; this.mesh.count = 0; }
}

// ---- ícones sobre os pés (gota / brilho) ------------------------------------------------------------
function iconTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.lineJoin = 'round';
  if (kind === 'drop') {
    g.beginPath();
    g.moveTo(64, 10);
    g.bezierCurveTo(64, 10, 20, 62, 20, 84);
    g.bezierCurveTo(20, 108, 40, 120, 64, 120);
    g.bezierCurveTo(88, 120, 108, 108, 108, 84);
    g.bezierCurveTo(108, 62, 64, 10, 64, 10);
    g.closePath();
    const grd = g.createLinearGradient(0, 10, 0, 120);
    grd.addColorStop(0, '#9ee4ff');
    grd.addColorStop(1, '#2f8fe8');
    g.fillStyle = grd;
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath();
    g.ellipse(48, 86, 7, 14, 0.4, 0, Math.PI * 2);
    g.fill();
  } else {
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 === 0 ? 54 : 20;
      const a = -Math.PI / 2 + (i * Math.PI) / 4;
      g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
    }
    g.closePath();
    g.fillStyle = '#ffd84d';
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = '#ffffff';
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class GardenMinigame {
  /** @param {import('./Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.world = null;
    this.phase = 'idle';          // idle -> water -> grow -> done
    this.reading = false;
    this.time = 0;
    this.plants = [];
    this.can = null;
    this.book = null;
    this.drops = null;
    this.tweens = [];
    this.timers = [];
    this.chan = null;             // canalização em andamento
    this.waterCount = 0;
    this.growCount = 0;
    this._held = false;
    this._lastScene = null;
    this.pouring = false;
    this.target = null;
    this.ownsAttack = false;
    this.icons = {};
  }

  // --------------------------------------------------------------------------------------------
  // Preparação: acha os nós no World01 e esconde os que começam escondidos
  // --------------------------------------------------------------------------------------------
  setup(world) {
    this.world = world;
    const by = world.byName;
    world.root.traverse((o) => { if (o.userData?.start_hidden) o.visible = false; });
    this.tpl = by.get('Prop_RedBerry') ?? null;
    if (this.tpl) this.tpl.visible = false;

    this.fx = new THREE.Group();
    this.fx.name = 'GardenFx';
    world.root.add(this.fx);
    this.drops = new Drops(this.fx);
    this.icons = { drop: iconTexture('drop'), spark: iconTexture('spark') };

    for (let i = 1; i <= GARDEN.total; i++) {
      const name = `GPlant_${String(i).padStart(2, '0')}`;
      const root = by.get(name);
      if (!root) continue;
      const pos = root.getWorldPosition(new THREE.Vector3());
      const plant = {
        i, pos, state: 'dry', water: 0, tries: 0, leafBase: 1, giant: null, wobble: 0,
        dry: by.get(`${name}_Dry`), leaves: by.get(`${name}_Leaves`), berries: by.get(`${name}_Berries`),
        phase: Math.random() * 6.28, decal: null, icon: null, iconKind: null, iconScale: 0,
      };
      // terra molhada: calota escura que aparece sobre a terra seca
      plant.decal = new THREE.Mesh(
        new THREE.SphereGeometry(1, 14, 8),
        new THREE.MeshStandardMaterial({ color: 0x2a170f, roughness: 1, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      );
      plant.decal.scale.set(0.245, 0.06, 0.245);
      plant.decal.position.set(pos.x, pos.y - 0.045, pos.z);
      plant.decal.visible = false;
      this.fx.add(plant.decal);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.icons.drop, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
      spr.renderOrder = 12;
      spr.visible = false;
      spr.scale.setScalar(0.001);
      this.fx.add(spr);
      plant.icon = spr;
      this.plants.push(plant);
    }

    // regador: vira filho de um pivô para inclinar/girar em volta do centro de massa
    const canNode = by.get('WateringCan');
    if (canNode) {
      const ud = canNode.userData ?? {};
      const pivot = new THREE.Group();
      pivot.name = 'WateringCanPivot';
      pivot.position.copy(canNode.position);
      world.root.add(pivot);
      pivot.add(canNode);
      canNode.position.set(0, 0, 0);
      canNode.rotation.set(0, 0, 0);
      this.can = {
        node: canNode, pivot, mode: 'ground', t: 0,
        home: pivot.position.clone(),
        vel: new THREE.Vector3(),
        yaw: 0, tilt: 0, roll: 0,
        rose: new THREE.Vector3(Number(ud.rose_x) || 0, Number(ud.rose_y) || 0.15, Number(ud.rose_z) || 0.38),
        roseDir: new THREE.Vector3(Number(ud.rose_dx) || 0, Number(ud.rose_dy) || 0.85, Number(ud.rose_dz) || 0.53).normalize(),
        item: world.interactables.find((it) => it.id === 'INT_WateringCan') ?? null,
        pour: 0, dropAcc: 0,
      };
    }
    this.bookNode = by.get('GardenBook') ?? null;
    this.glow = by.get('GardenBook_Glow') ?? null;
    if (this.glow) this.glowBase = this.glow.position.y;
    this.bookPos = (this.bookNode ?? by.get('INT_GardenBook'))?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
  }

  get ready() { return this.plants.length > 0; }

  // --------------------------------------------------------------------------------------------
  // Interações (E)
  // --------------------------------------------------------------------------------------------
  async interact(item) {
    if (!this.ready) return;
    if (item.kind === 'gardenbook') await this._readBook();
    else await this._touchCan(item);
  }

  async _readBook() {
    const g = this.game, p = g.player;
    await p.turnTo(this.bookPos);
    if (!g.state.flags.hasWand) { await g.say(LINE_BOOK_NO_WAND, { duration: 4200 }); return; }
    p.playAction('Interact', { events: { grab: () => g.sparkles.burst(this.bookPos.x, this.bookPos.y + 0.7, this.bookPos.z, 14, { ...MORE_SPARKS, palette: GOLD_PALETTE }) } });
    if (this.phase === 'idle') {
      this.reading = true;
      try { for (const line of LESSON_LINES) await g.say(line, { duration: 4400 }); } finally { this.reading = false; }
      this._setPhase('water');
      g.hint('Aperte E perto do regador azul', 5000);
      return;
    }
    const lines = this.phase === 'water' ? BOOK_AGAIN_WATER : this.phase === 'grow' ? BOOK_AGAIN_GROW : BOOK_DONE;
    await g.say(pick(lines), { duration: 4200 });
  }

  async _touchCan(item) {
    const g = this.game, p = g.player, c = this.can;
    if (!c) return;
    if (!g.state.flags.hasWand) { await g.say(CAN_NO_WAND, { duration: 3600 }); return; }
    if (this.phase === 'idle') { await g.say(CAN_BEFORE_BOOK, { duration: 4200 }); return; }
    if (this.phase !== 'water' || c.mode !== 'ground') { await g.say(pick(CAN_USED), { duration: 3200 }); return; }
    // levitar: toca Cast_Levitate; o regador sai do chão no meio do gesto
    item.disabled = true;
    await p.turnTo(c.pivot.position);
    g.say(pick(CAN_LIFT), { duration: 2400 });
    c.mode = 'cast';
    c.t = 0;
    c.castT = 0;
    p.playAction('Cast_Levitate', { fade: 0.18 });
    await this._delay(GARDEN.freeAt);
  }

  // --------------------------------------------------------------------------------------------
  // Fases
  // --------------------------------------------------------------------------------------------
  _setPhase(phase) {
    this.phase = phase;
    const ui = this.game.ui;
    if (phase === 'water') ui.setObjective?.(OBJ_WATER, this.waterCount, GARDEN.total);
    else if (phase === 'grow') ui.setObjective?.(OBJ_GROW, this.growCount, GARDEN.total);
    else if (phase === 'done') ui.setObjective?.(OBJ_GROW, GARDEN.total, GARDEN.total);
  }

  /** Dev: pula para uma fase (?garden=1&gphase=grow ou __game.garden.skipTo('grow')). */
  skipTo(phase) {
    if (phase === 'water' || phase === 'grow') {
      this.waterCount = 0;
      this.growCount = 0;
      for (const pl of this.plants) {
        pl.state = 'dry'; pl.water = 0;
        pl.dry && (pl.dry.visible = true);
        pl.leaves && (pl.leaves.visible = false);
        pl.berries && (pl.berries.visible = false);
        pl.decal.material.opacity = 0; pl.decal.visible = false;
        if (phase === 'grow') {
          pl.state = 'wet'; pl.water = GARDEN.waterTime;
          pl.dry && (pl.dry.visible = false);
          if (pl.leaves) { pl.leaves.visible = true; pl.leaves.scale.setScalar(1); }
          pl.decal.material.opacity = 0.92; pl.decal.visible = true;
        }
      }
      if (phase === 'grow') this.waterCount = GARDEN.total;
      this._setPhase(phase);
    }
  }

  _delay(sec) {
    return new Promise((resolve) => this.timers.push({ t: sec, resolve }));
  }

  _tween(dur, fn, done) {
    this.tweens.push({ t: 0, dur, fn, done });
  }

  // --------------------------------------------------------------------------------------------
  // Quadro a quadro
  // --------------------------------------------------------------------------------------------
  update(dt) {
    if (!this.ready) return;
    const g = this.game;
    dt = Math.min(dt, 0.05);
    this.time += dt;

    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) { this.timers.splice(i, 1); tm.resolve(); }
    }
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      tw.fn(k);
      if (k >= 1) { this.tweens.splice(i, 1); tw.done?.(); }
    }

    const outdoors = g.scenes.current === 'outdoor';
    if (outdoors !== this._lastScene) {
      this._lastScene = outdoors;
      if (outdoors && this.can && (this.can.mode === 'follow')) this._snapCan();
    }
    if (!outdoors) return;

    this._updateInput(dt);
    this._updatePlants(dt);
    this._updateCan(dt);
    this.drops.update(dt, (x, z) => this._floorAt(x, z), (x, y, z) => this._splash(x, y, z));
    if (this.glow) {
      this.glow.position.y = this.glowBase + Math.sin(this.time * 2.1) * 0.02;
      this.glow.rotation.y += dt * 0.7;
    }
    if (this.ownsAttack) g.player.attackCooldown = Math.max(g.player.attackCooldown, 0.22);
  }

  _floorAt(x, z) {
    for (const pl of this.plants) if (Math.hypot(pl.pos.x - x, pl.pos.z - z) < 0.45) return pl.pos.y - 0.02;
    return 0.02;
  }

  _splash(x, y, z) {
    if (Math.random() < 0.35) this.game.sparkles.burst(x, y + 0.02, z, 1, { speed: 0.35, life: 0.3, size: 0.04, gravity: -1, palette: WATER_PALETTE });
  }

  // ----- entrada: regar / canalizar -------------------------------------------------------------------
  _updateInput(dt) {
    const g = this.game, p = g.player, input = g.input;
    const held = input.attackHeld;
    const rising = held && !this._held;
    this._held = held;
    const free = !p.locked && !p.script && !p.defeated && !g.transitioning && input.enabled && !this.reading;

    // ---- canalizando (fase 2)
    if (this.chan) {
      this.ownsAttack = true;
      this._updateChannel(dt, held, free);
      this.pouring = false;
      return;
    }

    const c = this.can;
    const canActive = !!c && c.mode === 'follow' && this.phase === 'water';
    this.target = null;
    this.pouring = false;
    this.ownsAttack = false;

    if (canActive && free) {
      this.ownsAttack = true;                       // com o regador no ar, Espaço é "regar", nunca raio
      this.target = this._pickWaterTarget();
      this.pouring = held && !p.busy;
      if (this.pouring && this.target) this._water(this.target, dt);
    }

    if (this.phase === 'grow' && free) {
      const wet = this._nearestWet();
      if (wet) {
        this.ownsAttack = true;                     // perto de um pé regado, Espaço é "crescer"
        this.target = wet;
        if (rising && !p.busy) this._startChannel(wet);
      }
    }
  }

  _pickWaterTarget() {
    const p = this.game.player;
    p.forward(_f);
    _p.set(p.pos.x + _f.x * 0.9, 0, p.pos.z + _f.z * 0.9);
    let best = null, bd = GARDEN.waterPick;
    for (const pl of this.plants) {
      if (pl.state !== 'dry') continue;
      if (Math.hypot(pl.pos.x - p.pos.x, pl.pos.z - p.pos.z) > GARDEN.waterReach) continue;
      const d = Math.hypot(pl.pos.x - _p.x, pl.pos.z - _p.z);
      if (d < bd) { bd = d; best = pl; }
    }
    return best;
  }

  _nearestWet() {
    const p = this.game.player;
    p.forward(_f);
    let best = null, bd = Infinity;
    for (const pl of this.plants) {
      if (pl.state !== 'wet') continue;
      const dx = pl.pos.x - p.pos.x, dz = pl.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > GARDEN.growReach) continue;
      const score = d - 0.35 * Math.max(0, (dx * _f.x + dz * _f.z) / (d || 1));   // prefere o que está à frente
      if (score < bd) { bd = score; best = pl; }
    }
    return best;
  }

  // ----- rega -------------------------------------------------------------------------------------------
  _water(pl, dt) {
    pl.water += dt;
    const k = clamp(pl.water / GARDEN.waterTime, 0, 1);
    pl.decal.visible = true;
    pl.decal.material.opacity = smoothstep(k) * 0.92;
    if (pl.water >= GARDEN.waterTime) this._watered(pl);
  }

  _watered(pl) {
    const g = this.game;
    pl.state = 'wet';
    pl.decal.material.opacity = 0.92;
    if (pl.dry) pl.dry.visible = false;
    if (pl.leaves) {
      pl.leaves.visible = true;
      pl.leaves.scale.setScalar(0.5);
      this._tween(0.55, (k) => pl.leaves.scale.setScalar(0.5 + 0.5 * easeOutBack(k, 2.0)));
    }
    g.sparkles.burst(pl.pos.x, pl.pos.y + 0.15, pl.pos.z, 22, { ...MORE_SPARKS, palette: WATER_PALETTE });
    g.sparkles.burst(pl.pos.x, pl.pos.y + 0.1, pl.pos.z, 10, { speed: 1.0, life: 0.9, size: 0.06, gravity: -0.4, palette: GROW_PALETTE });
    g.texts.spawn('Glub!', pl.pos.x, pl.pos.y + 0.55, pl.pos.z, { scale: 0.55 });
    this.waterCount++;
    g.ui.setObjective?.(OBJ_WATER, this.waterCount, GARDEN.total);
    if (this.waterCount >= GARDEN.total) this._finishWater();
  }

  _finishWater() {
    const g = this.game;
    this.can.mode = 'return';
    this.can.vel.set(0, 0, 0);
    this._setPhase('grow');
    g.say(LINE_WATER_DONE, { duration: 5200 });
    g.hint(HINT_GROW, 6000);
  }

  // ----- canalizar (fase 2) -----------------------------------------------------------------------------
  _startChannel(pl) {
    const g = this.game, p = g.player;
    const zs = GARDEN.zone[0] + (Math.random() - 0.5) * 0.06;
    const ze = zs + (GARDEN.zone[1] - GARDEN.zone[0]);
    this.chan = { pl, t: 0, frozen: false, zone: [zs, ze], over: 0, flash: 0 };
    p.playAction('Cast_Lumos', { fade: 0.15, faceYaw: yawOf(pl.pos.x - p.pos.x, pl.pos.z - p.pos.z) });
    g.ui.showMeter?.({ value: 0, zoneStart: zs, zoneEnd: ze, label: 'Solte na faixa verde!' });
  }

  _endChannel() {
    const g = this.game, p = g.player;
    if (this.chan?.frozen) p.animator.setTimeScale(1);
    this.chan = null;
    g.ui.hideMeter?.();
  }

  _updateChannel(dt, held, free) {
    const g = this.game, p = g.player, ch = this.chan;
    // interrompida (levou um golpe, cena trocou, travou...)
    if (!free || p.defeated || !p.busy || p.busy.name !== 'Cast_Lumos') { this._endChannel(); return; }
    ch.t += dt;
    const fill = Math.min(1.0, ch.t / GARDEN.fillTime);
    if (!ch.frozen && p.animator.time >= GARDEN.holdAt) { p.animator.setTimeScale(0); ch.frozen = true; }
    if (fill >= 1) ch.over += dt;
    const pulse = 0.022 * Math.sin(ch.t * 17) * (0.4 + 0.6 * fill);
    g.ui.showMeter?.({ value: clamp(fill + pulse, 0, 1) });

    // brilho que cresce em volta do pé e fiapos de magia da varinha até ele
    ch.flash -= dt;
    if (ch.flash <= 0) {
      ch.flash = 0.11 - 0.06 * fill;
      const a = Math.random() * 6.28, r = 0.32 * (1 - 0.5 * fill);
      g.sparkles.emit({
        x: ch.pl.pos.x + Math.cos(a) * r, y: ch.pl.pos.y + 0.05, z: ch.pl.pos.z + Math.sin(a) * r,
        vx: -Math.cos(a) * 0.3, vy: 0.5 + fill, vz: -Math.sin(a) * 0.3,
        life: 0.8, size: 0.055 + 0.04 * fill, r: GROW_PALETTE[1][0], g: GROW_PALETTE[1][1], b: GROW_PALETTE[1][2], gravity: -0.2, drag: 1.2,
      });
      p.wandTipWorld(_w);
      g.sparkles.emit({ x: _w.x, y: _w.y, z: _w.z, vx: (Math.random() - 0.5) * 0.5, vy: 0.4, vz: (Math.random() - 0.5) * 0.5, life: 0.5, size: 0.05, r: 2.2, g: 2.0, b: 1.2, gravity: -0.3, drag: 1.5 });
    }

    const overflowed = ch.over >= GARDEN.overflow;
    if (!held || overflowed) this._release(overflowed ? Math.max(fill, 1) : fill);
  }

  _release(fill) {
    const g = this.game, p = g.player, ch = this.chan;
    const pl = ch.pl;
    const [zs, ze] = ch.zone;
    this._endChannel();
    if (p.busy) p.busy.cancelable = true;
    if (fill < zs) this._growSmall(pl);
    else this._growFull(pl, fill > ze);
  }

  _growSmall(pl) {
    const g = this.game;
    pl.tries++;
    pl.leafBase = Math.min(1.24, pl.leafBase + 0.07);
    const base = pl.leafBase;
    if (pl.leaves) this._tween(0.45, (k) => pl.leaves.scale.setScalar(base + 0.1 * Math.sin(Math.PI * k) * (1 - 0.3 * k)));
    g.sparkles.burst(pl.pos.x, pl.pos.y + 0.15, pl.pos.z, 12, { ...MORE_SPARKS, palette: GROW_PALETTE });
    g.texts.spawn('Quase!', pl.pos.x, pl.pos.y + 0.6, pl.pos.z, { scale: 0.6 });
    if (pl.tries % 2 === 1) g.say(pick(LINES_EARLY), { duration: 2600 });
  }

  _growFull(pl, giant) {
    const g = this.game, p = g.player;
    pl.state = 'grown';
    pl.decal.material.opacity = 0.92;
    if (pl.leaves) {
      const base = pl.leafBase;
      const fin = GARDEN.leafFinal;
      const pop = GARDEN.leafPop;
      this._tween(0.8, (k) => pl.leaves.scale.setScalar(k < 0.4 ? base + (pop - base) * easeOutBack(k / 0.4, 1.8) : pop + (fin - pop) * smoothstep((k - 0.4) / 0.6)));
    }
    if (pl.berries) {
      pl.berries.visible = true;
      pl.berries.scale.setScalar(0.15);
      this._tween(0.7, (k) => pl.berries.scale.setScalar(0.15 + 0.85 * easeOutBack(k, 2.2)));
    }
    g.sparkles.burst(pl.pos.x, pl.pos.y + 0.25, pl.pos.z, 34, { speed: 2.0, life: 1.1, size: 0.08, gravity: -0.8, palette: GROW_PALETTE });
    g.sparkles.burst(pl.pos.x, pl.pos.y + 0.35, pl.pos.z, 18, { speed: 1.4, life: 1.1, size: 0.08, gravity: -0.5, palette: GOLD_PALETTE });
    if (giant) this._spawnGiant(pl);
    g.texts.spawn(giant ? 'Gigante!' : '+1', pl.pos.x, pl.pos.y + 0.8, pl.pos.z, { scale: giant ? 0.8 : 0.62 });
    if (giant) p.playAction('Surprised', { cancelAfter: null, fade: 0.1 });
    else p.playAction('Cheer', { cancelAfter: 'hop' });
    g.say(giant ? pick(LINES_GIANT) : pick(LINES_GROW_OK), { duration: 3200 });
    this.growCount++;
    g.ui.setObjective?.(OBJ_GROW, this.growCount, GARDEN.total);
    if (this.growCount >= GARDEN.total) this._complete();
  }

  /** Morango GIGANTE (clone de Prop_RedBerry): cresce com um balanço e fica no pé. */
  _spawnGiant(pl) {
    if (!this.tpl) {                      // sem o modelo: aumenta os morangos do pé
      if (pl.berries) this._tween(0.9, (k) => pl.berries.scale.setScalar(1 + (GARDEN.giantScale * 0.55 - 1) * easeOutBack(k, 2.5)));
      return;
    }
    const m = this.tpl.clone(true);
    m.visible = true;
    m.traverse((o) => { if (o.isMesh) { o.visible = true; o.castShadow = true; o.receiveShadow = false; } });
    m.position.set(pl.pos.x + 0.04, pl.pos.y + 0.0, pl.pos.z + 0.2);
    m.rotation.set(0, Math.random() * 6.28, 0.12);
    this.fx.add(m);
    pl.giant = m;
    const S = GARDEN.giantScale;
    this._tween(1.1, (k) => {
      const grow = easeOutBack(Math.min(1, k * 1.15), 2.6);
      const wob = 1 + 0.13 * Math.sin(k * 26) * Math.exp(-k * 3.6);
      m.scale.set(S * grow * wob, S * grow / wob, S * grow * wob);
    });
  }

  // ----- desbloqueio ---------------------------------------------------------------------------------------
  async _complete() {
    const g = this.game;
    this.phase = 'done';
    await this._delay(GARDEN.celebrateAfter);
    g.state.flags.sproutSpell = true;
    g.ui.setObjective?.(OBJ_GROW, GARDEN.total, GARDEN.total);
    g.ui.showUnlock?.(UNLOCK_TITLE, UNLOCK_SUB);
    g.sparkles.burst(g.player.pos.x, g.player.pos.y + 0.9, g.player.pos.z, 40, { speed: 2.2, life: 1.2, size: 0.09, gravity: -0.6, palette: GOLD_PALETTE });
    this._catsCome();
    for (const line of LINES_DONE) await g.say(line, { duration: 4200 });
  }

  /** Os gatos correm para perto da Aprendiz e ficam olhando (reação "geladeira": corre até o ponto, mia, olha). */
  _catsCome() {
    const g = this.game, p = g.player;
    const pos = { x: p.pos.x, z: p.pos.z };
    const spots = {};
    const names = Object.keys(g.cats);
    names.forEach((name, i) => {
      const a = p.yaw + (i % 2 === 0 ? 1 : -1) * 0.9;
      const x = p.pos.x + Math.sin(a) * 0.6, z = p.pos.z + Math.cos(a) * 0.6;
      spots[name] = g.nav.nearestFree(x, z, 1) ?? { x, z };
    });
    for (const cat of g._activeCats()) cat.brain.react('fridge', { pos, spots });
  }

  // --------------------------------------------------------------------------------------------
  // Plantas: ícones, balanço, o morango gigante
  // --------------------------------------------------------------------------------------------
  _updatePlants(dt) {
    const showIcons = this.phase === 'water' || this.phase === 'grow';
    for (const pl of this.plants) {
      // pé murcho: balança de leve; o ícone mostra o que fazer
      if (pl.state === 'dry' && pl.dry) {
        const w = this.pouring && this.target === pl ? 0.07 : 0.02;
        pl.dry.rotation.z = Math.sin(this.time * 1.7 + pl.phase) * w;
        pl.dry.rotation.x = Math.cos(this.time * 1.3 + pl.phase) * w * 0.7;
      }
      const want = showIcons && ((this.phase === 'water' && pl.state === 'dry' && !!this.can) || (this.phase === 'grow' && pl.state === 'wet'));
      const kind = pl.state === 'dry' ? 'drop' : 'spark';
      if (pl.iconKind !== kind) { pl.icon.material.map = this.icons[kind]; pl.icon.material.needsUpdate = true; pl.iconKind = kind; }
      pl.iconScale = damp(pl.iconScale, want ? 1 : 0, 9, dt);
      const hot = this.target === pl;
      pl.icon.visible = pl.iconScale > 0.02;
      if (pl.icon.visible) {
        const bob = Math.sin(this.time * 3 + pl.phase) * 0.04;
        pl.icon.position.set(pl.pos.x, pl.pos.y + 0.62 + bob, pl.pos.z);
        pl.icon.scale.setScalar(0.24 * pl.iconScale * (hot ? 1.35 + 0.08 * Math.sin(this.time * 10) : 1));
      }
      if (pl.giant) {
        // respira devagar depois de crescer
        pl.giant.position.y = pl.pos.y + Math.sin(this.time * 2 + pl.phase) * 0.003;
      }
    }
    // folhagem dos pés crescidos: balanço suave
    for (const pl of this.plants) {
      if (pl.state !== 'dry' && pl.leaves) {
        pl.leaves.rotation.z = Math.sin(this.time * 1.2 + pl.phase) * 0.012;
      }
    }
  }

  // --------------------------------------------------------------------------------------------
  // O regador flutuante
  // --------------------------------------------------------------------------------------------
  _snapCan() {
    const c = this.can;
    const g = this.game, p = g.player;
    p.forward(_f);
    c.pivot.position.set(p.pos.x + _f.x * GARDEN.follow.fwd, GARDEN.follow.y, p.pos.z + _f.z * GARDEN.follow.fwd);
    c.vel.set(0, 0, 0);
    c.yaw = p.yaw;
  }

  _updateCan(dt) {
    const c = this.can;
    if (!c || c.mode === 'ground') return;
    const g = this.game, p = g.player;
    const piv = c.pivot;

    if (c.castT !== undefined) {                     // depois de ~1,5 s do gesto, andar cancela o resto do clip
      c.castT += dt;
      if (c.castT >= GARDEN.freeAt) { if (p.busy?.name === 'Cast_Levitate') p.busy.cancelable = true; c.castT = undefined; }
    }
    if (c.mode === 'cast') {
      c.t += dt;
      if (c.t < GARDEN.liftAt) {
        // antes de subir, treme um pouquinho (a magia pegando)
        c.node.rotation.z = Math.sin(this.time * 40) * 0.03 * smoothstep(c.t / GARDEN.liftAt);
        return;
      }
      c.node.rotation.z = 0;
      c.mode = 'follow';
      c.yaw = p.yaw;
      g.sparkles.burst(piv.position.x, piv.position.y + 0.1, piv.position.z, 20, { ...MORE_SPARKS, palette: GOLD_PALETTE });
      g.sparkles.burst(piv.position.x, piv.position.y + 0.1, piv.position.z, 12, { ...MORE_SPARKS, palette: WATER_PALETTE });
    }

    // ---- alvo: voltando para casa / pairando sobre o pé / seguindo a Aprendiz
    let gx, gy, gz, gyaw, gtilt = 0;
    const pouring = c.mode === 'follow' && this.pouring;
    p.forward(_f);
    if (c.mode === 'return') {
      gx = c.home.x; gy = c.home.y; gz = c.home.z; gyaw = 0;
      if (Math.hypot(piv.position.x - gx, piv.position.z - gz) < 0.05 && Math.abs(piv.position.y - gy) < 0.03) {
        piv.position.copy(c.home);
        c.mode = 'ground';
        c.yaw = 0; piv.rotation.set(0, 0, 0);
        if (c.item) c.item.disabled = false;
        return;
      }
    } else if (pouring && this.target) {
      const tp = this.target.pos;
      gyaw = yawOf(tp.x - p.pos.x, tp.z - p.pos.z);
      const back = c.rose.z;       // o bico fica `rose.z` à frente do centro: recua para o bico ficar sobre o pé
      gx = tp.x - Math.sin(gyaw) * back;
      gz = tp.z - Math.cos(gyaw) * back;
      gy = tp.y + GARDEN.hoverY - c.rose.y * 0.6;
      gtilt = GARDEN.tilt;
    } else {
      const F = GARDEN.follow;
      gx = p.pos.x + _f.x * F.fwd - _f.z * F.side;          // um pouco à direita dela
      gz = p.pos.z + _f.z * F.fwd + _f.x * F.side;
      gy = F.y + Math.sin(this.time * GARDEN.bob.hz) * GARDEN.bob.amp;
      gyaw = pouring ? p.yaw : p.yaw + Math.sin(this.time * 0.9) * 0.12;
      if (pouring) gtilt = GARDEN.tilt * 0.8;
    }

    // ---- mola (flutua com um pouco de atraso e balanço)
    const { k, c: damping } = GARDEN.spring;
    const ax = (gx - piv.position.x) * k - c.vel.x * damping;
    const ay = (gy - piv.position.y) * k - c.vel.y * damping;
    const az = (gz - piv.position.z) * k - c.vel.z * damping;
    c.vel.x += ax * dt; c.vel.y += ay * dt; c.vel.z += az * dt;
    piv.position.x += c.vel.x * dt; piv.position.y += c.vel.y * dt; piv.position.z += c.vel.z * dt;
    c.yaw = dampAngle(c.yaw, gyaw, 7, dt);
    c.tilt = damp(c.tilt, gtilt, 7, dt);
    const sp = Math.hypot(c.vel.x, c.vel.z);
    const lean = clamp(sp * 0.09, 0, 0.22);
    const sway = Math.sin(this.time * 1.6) * 0.045 + clamp(c.vel.x * 0.05, -0.15, 0.15) * Math.cos(c.yaw) - clamp(c.vel.z * 0.05, -0.15, 0.15) * Math.sin(c.yaw);
    _e.set(c.tilt + lean * (pouring ? 0 : 1) + Math.sin(this.time * 2.1) * 0.025, c.yaw, sway, 'YXZ');
    piv.quaternion.setFromEuler(_e);

    // ---- água saindo do bico
    if (pouring) {
      c.dropAcc += GARDEN.dropsPerSec * dt;
      piv.updateMatrixWorld(true);
      while (c.dropAcc >= 1) {
        c.dropAcc -= 1;
        _w.copy(c.rose);
        piv.localToWorld(_w);
        _d.copy(c.roseDir).applyQuaternion(piv.quaternion);
        this.drops.spawn(
          _w.x + (Math.random() - 0.5) * 0.05, _w.y, _w.z + (Math.random() - 0.5) * 0.05,
          _d.x * 0.7 + (Math.random() - 0.5) * 0.25, Math.min(0.1, _d.y * 0.4) - 0.1, _d.z * 0.7 + (Math.random() - 0.5) * 0.25,
        );
      }
    } else {
      c.dropAcc = 0;
    }
  }

  /** Dev/teste: posição do bico no mundo. */
  roseWorld(out = new THREE.Vector3()) {
    if (!this.can) return out;
    out.copy(this.can.rose);
    return this.can.pivot.localToWorld(out);
  }
}
