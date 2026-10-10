// Sequências de história (cutscenes) data-driven.
//
// Uma sequência é uma lista de passos (objetos simples). `story.play(nome)` roda os
// passos em ordem e espera cada um terminar. Para um novo easter egg: adicione uma
// entrada em STORY e chame `story.play('nome')` no gatilho (ex.: ao interagir).
//
// O jogo entrega um "mundo" com estes métodos (podem devolver Promise):
//   say(text, { speaker, duration, at })   balão de fala. `at` = nome de ponto/ator
//                                          (padrão: cabeça do speaker). O mundo mantém
//                                          a âncora do balão em dia a cada quadro.
//   hint(text, ms, at)                     dica no rodapé (`at` é opcional)
//   fade(to, ms)                           tela preta (1) / limpa (0)
//   playClip(actor, clip, { loop })        toca um clip; resolve quando um clip de uma
//                                          vez termina (clips cíclicos podem resolver já)
//   moveTo(actor, to, { speed, stopDist }) anda até `to` (nome de ponto, 'player' ou
//                                          {x,y,z}); resolve ao chegar
//   lookAt(actor, target)                  vira para um ator ou ponto
//   spawn(actor, at)                       mostra o ator na posição do ponto
//   visible(actor, bool)                   mostra/esconde um ator
//   swing(object, { open, wobble })        abre/fecha um objeto articulado (ex.: CatFlap);
//                                          resolve quando para (wobble = balanço amortecido)
//   lockPlayer(bool)                       trava/destrava os controles da Aprendiz
//   action(name, args)                     gancho específico do jogo (ex.: 'peticoJoinsCompanion')
//
// Passos especiais do próprio Story (não vão para o mundo): wait, waitFlag, setFlag, run e
//   { type: 'parallel', branches: [[passos...], [passos...]] }   roda os ramos juntos e espera todos.
//
// Pontos de cena (empties do House.glb) usados aqui: Fridge_Door, CatFlap,
// PATH_CatOutside, PATH_CatFlapIn, SPAWN_PeticoReturn.

// Textos das falas. Para mudar uma fala, mude só aqui.
export const LINE_OPENING = 'Hmm... que fome. Será que tem alguma coisa na geladeira?';
export const HINT_CONTROLS = 'WASD ou setas para andar · Shift corre · E interage';
export const HINT_CONTROLS_WAND = 'WASD ou setas para andar · Shift corre · E interage · Espaço ataca';
export const LINE_FRIDGE_HINT = 'Dica: a geladeira está ali na cozinha. Aperte E perto dela.';
export const LINE_FRIDGE_NUDGE = 'Que tal dar uma olhadinha na geladeira?';
export const LINE_FRIDGE_DREAM = 'Isso me parece um sonho.';
export const LINE_PETICO_AT_DOOR = { speaker: 'Petico', text: 'Miau!' };
export const LINE_PETICO_RETURN = { speaker: 'Aprendiz', text: 'Nossa, você tava desaparecido! Onde é que você tava?' };
export const LINE_PETICO_ANSWER = { speaker: 'Petico', text: 'Miau...' };

// v0.2: primeiro encontro com a Divonica (as duas falas marcadas são as aprovadas: não mexer).
export const LINE_DIVONICA_WAND = 'Espera! Isso é seu? É igualzinha à varinha da Hermione! Madeira de videira, fibra de coração de dragão, uns 27 centímetros...';
export const LINE_APPRENTICE_WAND = 'A varinha da Hermione... agora é minha?!';
export const LINE_DIVONICA_WARN_1 = 'Cuidado! A Floresta Sombria, aqui ao oeste, está cheia de Sombritos bravinhos. Eles não gostam de visita!';
export const LINE_DIVONICA_WARN_2 = 'Se um deles vier, aponte a varinha e aperte Espaço, J ou clique: é raio mágico neles!';
export const HINT_ATTACK = 'Espaço, J ou clique: raio mágico · Esc: pausa · C: close · botão direito: girar a câmera';

export const STORY = {
  // v0.2, primeira vez que ela sai de casa: a Divonica vem correndo, acena e entrega a varinha.
  divonicaMeet: {
    once: true,
    steps: [
      { type: 'control', locked: true },
      { type: 'wait', ms: 700 },
      { type: 'spawn', actor: 'Divonica', at: 'PATH_DivonicaApproach' },
      { type: 'lookAt', actor: 'Aprendiz', target: 'PATH_DivonicaApproach' },
      { type: 'action', name: 'catsLook', args: { at: 'PATH_DivonicaApproach' } },
      {
        type: 'parallel',
        branches: [
          [{ type: 'moveTo', actor: 'Divonica', to: 'player', speed: 2.8, stopDist: 1.5 }],
          [{ type: 'wait', ms: 700 }, { type: 'camera', shot: 'twoShot', a: 'Aprendiz', b: 'Divonica' }],
        ],
      },
      { type: 'lookAt', actor: 'Divonica', target: 'player' },
      { type: 'lookAt', actor: 'Aprendiz', target: 'Divonica' },
      { type: 'playClip', actor: 'Divonica', clip: 'Wave' },
      { type: 'camera', shot: 'closeup', target: 'Divonica', other: 'Aprendiz' },
      { type: 'playClip', actor: 'Divonica', clip: 'Talk', background: true },
      { type: 'say', speaker: 'Divonica', text: LINE_DIVONICA_WAND, duration: 8200 },
      // a mão dela solta a varinha (release 44) quando a da Aprendiz pega (take 20): a Aprendiz começa 0,8 s depois
      {
        type: 'parallel',
        branches: [
          [{ type: 'playClip', actor: 'Divonica', clip: 'GiveWand' }],
          [
            { type: 'camera', shot: 'twoShot', a: 'Aprendiz', b: 'Divonica' },
            { type: 'wait', ms: 800 },
            { type: 'playClip', actor: 'Aprendiz', clip: 'ReceiveWand' },
          ],
        ],
      },
      { type: 'playClip', actor: 'Divonica', clip: 'Idle', background: true },
      { type: 'camera', shot: 'closeup', target: 'Aprendiz', other: 'Divonica' },
      { type: 'say', speaker: 'Aprendiz', text: LINE_APPRENTICE_WAND, duration: 4200 },
      { type: 'camera', shot: 'closeup', target: 'Divonica', other: 'Aprendiz' },
      { type: 'playClip', actor: 'Divonica', clip: 'Point', background: true },
      { type: 'say', speaker: 'Divonica', text: LINE_DIVONICA_WARN_1, duration: 5200 },
      { type: 'playClip', actor: 'Divonica', clip: 'Talk', background: true },
      { type: 'say', speaker: 'Divonica', text: LINE_DIVONICA_WARN_2, duration: 4800 },
      { type: 'playClip', actor: 'Divonica', clip: 'Idle', background: true },
      { type: 'camera', shot: 'default' },
      { type: 'action', name: 'divonicaHome' },
      { type: 'hint', text: HINT_ATTACK, ms: 9000 },
      { type: 'control', locked: false },
    ],
  },

  // Começo da casa: acorda com fome e procura a geladeira.
  // Não trava os controles: só espera e, sem pressa, dá uma nova dica a cada 40 s.
  opening: {
    once: true,
    steps: [
      // A tela clareia enquanto ela acorda (tudo ao mesmo tempo).
      {
        type: 'parallel',
        branches: [
          [{ type: 'fade', to: 0, ms: 1500 }],
          [{ type: 'playClip', actor: 'Aprendiz', clip: 'WakeUp' }],
        ],
      },
      { type: 'hint', text: HINT_CONTROLS, ms: 7000 },
      { type: 'say', speaker: 'Aprendiz', text: LINE_OPENING },
      { type: 'wait', ms: 1800 },
      { type: 'hint', text: LINE_FRIDGE_HINT, ms: 5000, at: 'Fridge_Door' },
      {
        type: 'waitFlag',
        flag: 'fridgeOpened',
        nudgeAfter: 40000,
        nudge: [{ type: 'hint', text: LINE_FRIDGE_NUDGE, ms: 4000, at: 'Fridge_Door' }],
      },
    ],
  },

  // Primeira vez que a geladeira é aberta: a geladeira cheia de morangos e, depois de 3 s,
  // o Petico volta para casa pela portinhola.
  fridgeDream: {
    once: true,
    steps: [
      { type: 'setFlag', name: 'fridgeOpened' },
      { type: 'say', speaker: 'Aprendiz', text: LINE_FRIDGE_DREAM },
      { type: 'wait', ms: 3000 },
      { type: 'run', sequence: 'peticoReturn' },
    ],
  },

  // O Petico chega pela portinhola e reencontra a Aprendiz. Ela fala com ele (ele não fala
  // de volta, só mia). Depois de carinho, ele passa a seguir a Aprendiz como companheiro.
  peticoReturn: {
    steps: [
      { type: 'control', locked: true },
      { type: 'say', speaker: LINE_PETICO_AT_DOOR.speaker, text: LINE_PETICO_AT_DOOR.text, at: 'CatFlap', duration: 1400 },
      { type: 'spawn', actor: 'Petico', at: 'PATH_CatOutside' },
      { type: 'moveTo', actor: 'Petico', to: 'CatFlap', speed: 1.2 },
      { type: 'swing', object: 'CatFlap', open: true },
      { type: 'moveTo', actor: 'Petico', to: 'PATH_CatFlapIn', speed: 1.4 },
      { type: 'swing', object: 'CatFlap', open: false, wobble: true },
      { type: 'moveTo', actor: 'Petico', to: 'player', speed: 2.4, stopDist: 0.9 },
      { type: 'lookAt', actor: 'Aprendiz', target: 'Petico' },
      { type: 'playClip', actor: 'Aprendiz', clip: 'Surprised' },
      { type: 'say', speaker: LINE_PETICO_RETURN.speaker, text: LINE_PETICO_RETURN.text },
      { type: 'lookAt', actor: 'Petico', target: 'Aprendiz' },
      { type: 'say', speaker: LINE_PETICO_ANSWER.speaker, text: LINE_PETICO_ANSWER.text },
      { type: 'playClip', actor: 'Petico', clip: 'Purr', ms: 3000, background: true },
      { type: 'playClip', actor: 'Aprendiz', clip: 'Interact' },
      { type: 'action', name: 'peticoJoinsCompanion', args: { actor: 'Petico' } },
      { type: 'control', locked: false },
    ],
  },
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0)));

export class Story {
  constructor(world, sequences = STORY) {
    this.world = world;
    this.sequences = sequences;
    // Marcas da partida (ex.: fridgeOpened). O jogo pode ler e escrever aqui.
    this.flags = {};
    this._waiters = new Map();
    this._gen = 0;
    this._locked = false;
  }

  // Roda a sequência `name`. A Promise resolve quando ela termina ou é cancelada.
  // Sequências `once` só rodam uma vez por partida.
  play(name) {
    const seq = this._seq(name);
    if (seq.once) {
      const key = `done:${name}`;
      if (this.flags[key]) return Promise.resolve();
      this.flags[key] = true;
    }
    return this._run(seq.steps, this._gen);
  }

  // Marca uma flag e acorda os passos `waitFlag` que a esperam.
  setFlag(name, value = true) {
    this.flags[name] = value;
    if (value && this._waiters.has(name)) {
      const list = this._waiters.get(name);
      this._waiters.delete(name);
      list.forEach((resolve) => resolve());
    }
  }

  // Interrompe as sequências em andamento (ex.: ao reiniciar a partida).
  // Um passo já iniciado termina, mas nenhum passo seguinte roda.
  cancel() {
    this._gen++;
    // Não deixa os controles travados se a sequência parou no meio de uma trava.
    if (this._locked) {
      this._locked = false;
      this.world.lockPlayer(false);
    }
  }

  _seq(name) {
    const seq = this.sequences[name];
    if (!seq) throw new Error(`Sequência de história desconhecida: "${name}"`);
    return seq;
  }

  async _run(steps, gen) {
    for (const step of steps) {
      if (gen !== this._gen) return;
      await this._step(step, gen);
    }
  }

  async _step(step, gen) {
    const w = this.world;
    switch (step.type) {
      case 'say':
        await w.say(step.text, { speaker: step.speaker ?? 'Aprendiz', duration: step.duration, at: step.at });
        return;
      case 'hint':
        w.hint(step.text, step.ms, step.at);
        return;
      case 'wait':
        await delay(step.ms);
        return;
      case 'waitFlag':
        await this._waitFlag(step, gen);
        return;
      case 'setFlag':
        this.setFlag(step.name, step.value ?? true);
        return;
      case 'fade':
        await w.fade(step.to, step.ms);
        return;
      case 'spawn':
        w.spawn(step.actor, step.at);
        return;
      case 'visible':
        w.visible(step.actor, step.visible);
        return;
      case 'lookAt':
        w.lookAt(step.actor, step.target);
        return;
      case 'moveTo':
        await w.moveTo(step.actor, step.to, { speed: step.speed, stopDist: step.stopDist });
        return;
      case 'playClip': {
        const done = w.playClip(step.actor, step.clip, { loop: step.loop, ms: step.ms });
        if (step.background) return;
        // `ms` serve para clips cíclicos (ex.: Purr), que não têm fim.
        await (step.ms !== undefined ? delay(step.ms) : done);
        return;
      }
      case 'swing':
        await w.swing(step.object, { open: step.open, wobble: step.wobble });
        return;
      case 'control':
        this._locked = !!step.locked;
        w.lockPlayer(this._locked);
        return;
      case 'action':
        await w.action(step.name, step.args);
        return;
      case 'camera': {
        const p = w.camera(step);
        if (step.wait !== false) await p;
        return;
      }
      case 'parallel':
        await Promise.all(step.branches.map((branch) => this._run(branch, gen)));
        return;
      case 'run':
        await this._run(this._seq(step.sequence).steps, gen);
        return;
      default:
        console.warn(`[Story] passo desconhecido: "${step.type}"`);
    }
  }

  // Espera uma flag. Com `nudgeAfter` + `nudge`, repete os passos `nudge` a cada
  // `nudgeAfter` ms enquanto a flag não chegar (sem travar o jogador).
  _waitFlag(step, gen) {
    const { flag, nudgeAfter = 0, nudge } = step;
    if (this.flags[flag]) return Promise.resolve();

    let reached = false;
    const reach = new Promise((resolve) => {
      const list = this._waiters.get(flag) ?? [];
      list.push(() => {
        reached = true;
        resolve();
      });
      this._waiters.set(flag, list);
    });
    if (!nudgeAfter || !nudge) return reach;

    return (async () => {
      while (!reached && gen === this._gen) {
        await Promise.race([reach, delay(nudgeAfter)]);
        if (!reached && gen === this._gen) await this._run(nudge, gen);
      }
    })();
  }
}
