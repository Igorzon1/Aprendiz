// Ajustes do mundo v0.2: cenários, transições, coletáveis e textos das interações.
// (Os textos principais da história ficam em Story.js; aqui ficam os das interações do cenário.)

export const TRANSITION = { fadeOut: 450, hold: 120, fadeIn: 650 };

// Visual de cada cenário (a casa usa RENDER de config.js)
export const OUTDOOR_LOOK = {
  background: '#9ad6f6',            // céu de dia
  fog: { color: '#cfeaf5', near: 26, far: 78 },
  hemi: { sky: '#dff0ff', ground: '#9bbf72', intensity: 1.2 },
  sun: { color: '#fff0cf', intensity: 2.4, offset: [9, 16, 11] },
  shadowHalf: 12,                   // metade do lado da câmera de sombra que segue a Aprendiz
  shadowMapSize: 2048,
};

export const WORLD_HALF = 30;       // área jogável: x, z em [-30, 30]

export const STRAWBERRY = {
  total: 12,
  pickupRadius: 0.6,
  hoverY: 0.5,
  storageKey: 'aprendiz.morangosDourados',
};

export const DIVONICA = {
  runSpeed: 2.8,
  stopDist: 1.5,
  talkRadius: 1.25,
  turnRange: 4.0,                    // vira para a Aprendiz quando ela chega perto
};

// ---- textos -------------------------------------------------------------------------------------
export const LINE_DOOR_HUNGRY = 'Primeiro, comida! Estou morrendo de fome... e a geladeira está logo ali.';
export const LINE_DOOR_WAIT_PETICO = 'Não vou sair sem o Petico... E se ele voltar e eu não estiver? Vou esperar mais um pouquinho.';
export const DOOR_PROMPT_LOCKED = 'Olhar a porta';

export const LINE_ALL_STRAWBERRIES = 'Doze morangos dourados... isso definitivamente me parece um sonho!';
export const TOAST_ALL_STRAWBERRIES = 'Todos os morangos dourados! 🍓✨';


export const LINES_SIGN = [
  'Placa: Floresta Sombria a oeste, Trilha das Brasas a leste e Colina dos Espíritos ao norte. Cada uma com seu mago...',
];
export const LINES_WELL = [
  'Fiz um pedido no poço... desejei morangos. Muitos morangos.',
  'Joguei uma moedinha e o poço respondeu: "...ngos... ...ngos..." Será que é eco?',
  'Um poço! Se eu cair, os gatos nunca me perdoam. Melhor ficar aqui fora.',
];
export const LINES_MAILBOX = [
  'Tem uma cartinha! "Querida Aprendiz, lembre de dar comida aos gatos. Eles dizem que já comeram. É mentira. — Vovó"',
  'A caixa de correio está vazia. Só tem uma folhinha de trevo... e sorte é sorte.',
];
export const LINES_BENCH = [
  'Ahh... que banquinho gostoso. Até os gatos vieram descansar comigo.',
  'Cinco minutinhos de sossego. Nada de Sombritos por aqui.',
];
export const LINES_POND = [
  'Vi um peixinho! Ou foi um morango? Hoje tudo parece morango.',
  'A água está tão clarinha que dá para ver o céu dentro dela.',
  'Splash! Ah, só um sapinho. Ele me deu uma olhada de julgamento.',
];

export const LINES_NPC_DIVONICA = [
  'Os três magos moram além das barreiras: o Arcanista, o Druida Sombrio e a Bruxa Espectral. Um dia a gente vai lá!',
  'Dizem que tem doze morangos dourados escondidos pelo vale. Eu achei um... e comi. Sem querer!',
  'Sabia que um Sombrito derrete com três raios? Eu perguntei. Ele não gostou da pergunta.',
  'O Druida Sombrio faz uns Sombritos fofinhos e bravos. Cuidado com eles!',
  'A Bruxa Espectral mora na Colina dos Espíritos. Dizem que ela é muito simpática... para fantasmas.',
  'O Arcanista cuida das brasas. Sempre tem cheirinho de marshmallow torrado por lá!',
  'Seus gatinhos são lindos! Posso fazer carinho? ...Ops, a Yumi já foi embora. Eles têm vontade própria, né?',
];

export const LINE_GATE = (area) => `Uma barreira mágica protege ${area}... (Em breve!)`;
