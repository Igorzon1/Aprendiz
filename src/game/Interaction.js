import * as THREE from 'three';
import { canTrainOnDummy } from './Progression.js';
import { pick } from './util.js';
import { LINES_DIVONICA_AFTER_BOSS, LINES_DIVONICA_AFTER_HOOK } from './configForest.js';
import {
  DOOR_PROMPT_LOCKED, LINES_BENCH, LINES_MAILBOX, LINES_NPC_DIVONICA, LINES_POND, LINES_SIGN, LINES_WELL,
  LINE_DOOR_HUNGRY, LINE_DOOR_WAIT_PETICO, LINE_GATE,
} from './configWorld.js';

const _fwd = new THREE.Vector3();

// Falas curtas das interações (charme). A porta usa LINES_DOOR_WAIT, e o caso "com fome" fica com LINE_DOOR_HUNGRY.
const LINES = {
  bed: [
    'Só mais cinco minutinhos... não, hoje não.',
    'A cama me chama, mas eu sou forte.',
    'Cama quentinha, travesseiro fofo... Perigo!',
    'Essa cama tem o formato exato de uma aprendiz cansada. Coincidência? Não.',
    'Se eu deitar agora, acordo amanhã com o gato no meu lugar. Ele já tentou.',
    'Uma soneca rápida antes da poção. Ou depois. Ou nunca.',
    'Travesseiro, cobertor e um gato dormindo em cima de tudo. Não sobrou espaço pra mim.',
  ],
  window: [
    'Lá fora tem um mundo inteiro. Um dia eu visito.',
    'Hoje o céu está com cara de feitiço bom.',
    'Será que alguma nuvem tem formato de gato?',
    'Um pássaro passou com chapéu. Ou era uma folha muito ambiciosa.',
    'Tem marca de focinho no vidro. O gato diz que não foi ele.',
    'Ainda não vi nenhuma vassoura passando. Continuo olhando.',
    'Chuva chegando. Vou fingir que fui eu que pedi.',
  ],
  bookshelf: [
    '"Como NÃO transformar o gato em sapo". Esse eu já li.',
    'Três livros de feitiços e vinte de receitas de bolo.',
    'Hmm... esse aqui está de cabeça para baixo faz um mês.',
    '"Feitiços para Iniciantes (e para Quem Já Falhou Duas Vezes)". Vou tentar a terceira.',
    '"Como Não Pegar Fogo na Cortina". Li até a metade. A fumaça atrapalhou.',
    '"Poções Rápidas em Dez Minutos". Não contam os dez minutos de explosão.',
    '"Tudo Sobre Gatos Mágicos". O gato já leu. Ele fez anotações nas margens.',
    '"Como Levitar Qualquer Coisa, Menos a Louça". Essa exceção ainda me assombra.',
    '"Manual da Bruxa Organizada". Coloquei na prateleira errada de propósito, pra ninguém achar.',
    '"Vassouras: Manutenção e Cuidados". Li tudo, mas a minha ainda não me respeita.',
    'Esse tem cara de feitiço poderoso... ou de receita de bolo com capa dramática.',
    '"Guia do Aluno Atrasado, Volume Três". Não estudo em escola nenhuma, mas me identifico.',
    '"Como Ser Uma Bruxa Sem Sustos (Sério)". Esse eu ainda não abri. Por motivos de medo.',
  ],
  cauldron: [
    'Borbulhando... acho que é só água mesmo.',
    'Hoje o caldeirão está de folga. Sopa depois?',
    'Tem cheiro de sopa. Ou de poção. Difícil dizer.',
    'Mexi três vezes no sentido horário. Acho que devia ser anti-horário.',
    'Não deixe o gato chegar perto. Ele acha que isso é uma tigela.',
    'Esse fundo já está preto de tanto eu esquecer o caldeirão no fogo.',
    'Cheira a bolo. Ou a poção com ambição de bolo.',
  ],
  generic: ['Hmm, interessante...', 'Que coisa mais charmosa.'],
};

// Porta trancada: a Aprendiz espera o Petico voltar (LINE_DOOR_WAIT_PETICO é o texto do roteiro).
const LINES_DOOR_WAIT = [
  LINE_DOOR_WAIT_PETICO,
  'Ainda não estou pronta para sair...',
  'Se eu sair agora e o Petico voltar, ele vai achar que eu fugi. Espero.',
  'Sair sem casaco e sem o gato? Nem pensar.',
  'Abrir a porta é fácil. Difícil é deixar a casa sem o Petico.',
  'Ainda não. Preciso vestir a capa e esperar o Petico.',
];

// Pelúcia do gatão: uma piada por toque, sorteada sem repetir a última.
export const PLUSH_LINES = [
  'Uma vez esse gatão assustou uma pessoa de tão grande. Ela jurou que era uma pantera tirando soneca!',
  'Esse aqui já fez uma visita gritar. Em defesa dele: ele estava só deitado.',
  'Ele é tão grande que já assustou gente... e olha que ele nem se mexe!',
];

const FRIDGE_AGAIN = [
  'Ainda tem morangos. Ainda parece um sonho.',
  'Morangos... tantos morangos.',
  'Só uma olhadinha. Prometo.',
];

/** Interações com os INT_* da casa: detecta o mais próximo à frente, mostra o prompt e dispara por `kind`. */
export class Interaction {
  constructor(game) {
    this.game = game;
    this.current = null;
    this.shownText = null;
    this.busy = false;
  }

  /** Item mais próximo dentro do raio e (mais ou menos) à frente da Aprendiz. */
  find() {
    const { player, world } = this.game;
    player.forward(_fwd);
    let best = null, bestD = Infinity;
    for (const it of world.interactables) {
      if (it.disabled) continue;                     // ex.: o regador enquanto flutua
      const dx = it.pos.x - player.pos.x, dz = it.pos.z - player.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > it.radius) continue;
      // INT_* points stand in FRONT of their object: once she is this close she may already have walked
      // past the point (it is then behind her), so the facing test only applies further away
      if (d > Math.min(0.75, it.radius * 0.8)) {
        const dot = (dx * _fwd.x + dz * _fwd.z) / d;
        if (dot < 0.15) continue; // atrás ou muito de lado
      }
      if (d < bestD) { bestD = d; best = it; }
    }
    return best;
  }

  promptFor(item) {
    if (item.kind === 'door' && !this.game.scenes.canLeave) return DOOR_PROMPT_LOCKED;
    if (item.kind === 'fridge' && this.game.world.fridge?.open) return 'Fechar geladeira';
    return item.prompt;
  }

  update() {
    const { player, input, ui } = this.game;
    const free = !player.locked && !player.busy && !this.busy && !player.script && input.enabled && !this.game.transitioning && !player.defeated;
    const item = free ? this.find() : null;
    this.current = item;

    const text = item ? `E  ${this.promptFor(item)}` : null;
    if (text !== this.shownText) {
      if (text) ui.showPrompt(text); else ui.hidePrompt();
      this.shownText = text;
    }
    if (item && input.interactPressed) this.trigger(item);
  }

  async trigger(item) {
    if (this.busy) return;
    this.busy = true;
    const { player, ui } = this.game;
    player.lock('interact');
    ui.hidePrompt();
    this.shownText = null;
    try {
      switch (item.kind) {
        case 'fridge': await this._fridge(item); break;
        case 'dummy': await this._dummy(item); break;
        case 'door': await this._door(item); break;
        case 'house_door': await this._houseDoor(item); break;
        case 'sign': await this._talk(item, LINES_SIGN, { anim: false }); break;
        case 'well': await this._talk(item, LINES_WELL, { anim: true }); break;
        case 'mailbox': await this._talk(item, LINES_MAILBOX, { anim: true }); break;
        case 'pond': await this._talk(item, LINES_POND, { anim: false }); break;
        case 'bench': await this._bench(item); break;
        case 'gate': await this._gate(item); break;
        case 'forest_enter': await this.game.forestStory.enter(); break;                 // v0.4: Floresta Sombria
        case 'to_vale': await this.game.forest.toVale(); break;
        case 'checkpoint': await this.game.forest.checkpoint(item); break;
        case 'druid_friend': await this.game.forest.druidChat(); break;
        case 'gardenbook': case 'wateringcan': await this.game.garden?.interact(item); break;   // v0.3: Horta Mágica
        case 'npc': await this._npcTalk(item); break;
        case 'window': await this._talk(item, LINES.window, { anim: false }); break;
        case 'bed': await this._talk(item, LINES.bed, { anim: true }); break;
        case 'plush': await this._plush(item); break;
        case 'bookshelf': await this._talk(item, LINES.bookshelf, { anim: true }); break;
        case 'cauldron': await this._talk(item, LINES.cauldron, { anim: true }); break;
        default: await this._talk(item, LINES[item.kind] ?? LINES.generic, { anim: true });
      }
    } finally {
      player.unlock('interact');
      this.busy = false;
    }
  }

  // --------------------------------------------------------------------------------------------
  /** Porta de casa: só abre depois que o Petico voltou; antes, ela comenta (fome / esperando o Petico). */
  async _door(item) {
    const g = this.game;
    if (g.scenes.canLeave) {
      await g.player.turnTo(item.pos);
      await g.scenes.go('outdoor');
      return;
    }
    const hungry = !g.story.flags.fridgeOpened;
    await g.player.turnTo(item.pos);
    await g.say(hungry ? LINE_DOOR_HUNGRY : pick(LINES_DOOR_WAIT));
  }

  async _houseDoor(item) {
    await this.game.player.turnTo(item.pos);
    await this.game.scenes.go('house');
  }

  async _bench(item) {
    const g = this.game;
    await g.player.turnTo(item.pos);
    const healed = g.vitals.hp < g.vitals.max ? g.vitals.heal(1) : 0;
    if (healed) g.ui.toast?.('Descansou um pouquinho: +1 vida', 1800);
    g.say(pick(LINES_BENCH));
    await g.player.playAction('Interact');
  }

  async _gate(item) {
    const g = this.game;
    if (item.id === 'INT_Gate_Forest' && g.forestStory) { await g.forestStory.interact(item); return; }
    await g.player.turnTo(item.pos);
    g.sparkles.burst(item.pos.x, 0.9, item.pos.z, 10, { speed: 0.8, life: 0.7, size: 0.06, gravity: 0.2 });
    await g.say(LINE_GATE(item.area ?? 'este lugar'));
  }

  /** Conversa com a Divonica: ela vira para a Aprendiz, fala uma das frases (em ordem) e volta ao Idle. */
  async _npcTalk() {
    const g = this.game;
    const npc = g.npcs.Divonica;
    if (!npc) return;
    const g0 = this.game;
    if (g0.state.flags.sproutSpell && !g0.story.flags['done:forestHook']) {          // v0.4: o gancho da Floresta Sombria
      await g0.story.play('forestHook');
      return;
    }
    this._npcLine = (this._npcLine ?? -1) + 1;
    const pool = g0.story.flags.druidDefeated ? [...LINES_DIVONICA_AFTER_BOSS, ...LINES_NPC_DIVONICA]
      : g0.story.flags['done:forestHook'] ? [...LINES_DIVONICA_AFTER_HOOK, ...LINES_NPC_DIVONICA] : LINES_NPC_DIVONICA;
    const line = pool[this._npcLine % pool.length];
    await g.player.turnTo(npc.pos);
    npc.faceTo(g.player.pos.x, g.player.pos.z);
    npc.setIdleClip('Talk');
    g.cameraRig.setShot?.('closeup', { target: 'Divonica', other: 'Aprendiz' });
    try {
      await g.say(line, { speaker: 'Divonica', duration: 5200 });
    } finally {
      npc.setIdleClip('Idle');
      setTimeout(() => npc.faceTo(null), 800);
      g.cameraRig.setShot?.('default');
    }
  }

  async _talk(item, lines, { anim }) {
    const { player } = this.game;
    await player.turnTo(item.pos);
    this.game.say(pick(lines));
    if (anim) await player.playAction('Interact');
  }

  /** Pelúcia do gatão: vira para ela, age, dá um close e fala; o close volta ao normal depois da fala. */
  async _plush(item) {
    const { player, cameraRig } = this.game;
    await player.turnTo(item.pos);
    await player.playAction('Interact');
    cameraRig.setShot?.('closeup', { target: this.game.player });
    try {
      await this.game.say(pick(PLUSH_LINES));
    } finally {
      cameraRig.setShot?.('default');
    }
  }

  /** EASTER EGG #1: geladeira de morangos. */
  async _fridge(item) {
    const { player, world, story } = this.game;
    const fridge = world.fridge;
    if (!fridge) { await this._talk(item, LINES.generic, { anim: true }); return; }

    await player.turnTo(fridge.center);
    const opening = !fridge.open;
    // No evento `grab` a porta abre/fecha (se o clip não tiver o evento, garantimos depois).
    await player.playAction('Interact', { events: { grab: () => fridge.set(opening) } });
    if (fridge.open !== opening) fridge.set(opening);
    if (!opening) return;

    const first = !story.flags.fridgeOpened;
    if (first) {
      this.game.ui.showHint('');   // the "go to the fridge" nudge is done
      // "Isso me parece um sonho." + (3 s depois) a volta do Petico: tudo na sequência da história.
      story.play('fridgeDream');
    } else if (Math.random() < 0.6) {
      this.game.say(pick(FRIDGE_AGAIN));
    }
    await player.playAction('Surprised');
  }

  async _dummy(item) {
    const { player, world, state, sayUI } = this.game;
    await player.turnTo(world.dummy?.center ?? item.pos);
    if (!canTrainOnDummy(state, sayUI)) return;
    const c = world.dummy?.center ?? item.pos;
    const attack = player.tryAttack({ x: c.x, z: c.z }, { force: true });
    if (attack) await attack; // solta os controles quando o ataque termina
  }
}

