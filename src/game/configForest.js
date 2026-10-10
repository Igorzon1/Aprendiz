// v0.4: Floresta Sombria + Druida Sombrio (chefe). Ajustes de jogo e TODOS os textos (português do Brasil) ficam aqui.

// ---- visual ---------------------------------------------------------------------------------------
export const FOREST_LOOK = {
  background: '#1b1133',
  fog: { color: '#2e1b4d', near: 14, far: 60 },
  hemi: { sky: '#a8b6f2', ground: '#4e6070', intensity: 1.15 },
  sun: { color: '#c9d6ff', intensity: 1.5, offset: [-5, 16, 8] },     // luar
  shadowHalf: 11,
  shadowMapSize: 2048,
  bloom: { strength: 0.5, radius: 0.5, threshold: 1.1 },
  fogMeshOpacity: 0.3,
};

export const FOREST = {
  strawberries: 8,
  pickupRadius: 0.65,
  hoverY: 0.5,
  brambleHp: 3,               // mordidas do Broto Guardião para derrubar um espinheiro
  brambleHint: 3.4,           // m: a dica do espinheiro aparece a essa distância
  checkpointHeal: true,
  gateGrowTime: 0.9,          // s: o portão da arena fecha
  bloomCount: 70,             // flores / cogumelos que brotam depois da luta
  // variantes por ponto ENEMY_* (o resto é Sombrito comum): 1º grupo só comuns, 2º apresenta o Cuspidor,
  // 3º um Sombrão com um Cuspidor dando cobertura
  enemyVariants: { ENEMY_Sombrito_05: 'spitter', ENEMY_Sombrito_06: 'brute', ENEMY_Sombrito_07: 'spitter' },
};

// ---- chefe -------------------------------------------------------------------------------------------
export const BOSS = {
  hp: 30,
  radius: 0.45,
  scale: 1.0,
  phase2: 0.6,                // fração da vida
  phase3: 0.3,
  hitCooldown: 0.75,          // s entre animações Hit (o dano sempre vale)
  gap: { 1: [0.9, 1.35], 2: [0.65, 1.05], 3: [0.4, 0.75] },   // s de pausa entre ataques por fase
  speed: { 1: 1.2, 2: 1.35, 3: 1.55 },                         // velocidade dos clips / avisos
  tpChance: { 1: 0.5, 2: 0.4, 3: 0.3 },                        // chance de sumir/reaparecer depois de um ataque
  tpDist: [3.4, 5.2],         // m: onde ele reaparece em relação a ela
  tpVanish: 0.2,
  tpAppear: 0.24,
  orb: { speed: 2.5, turn: 1.15, life: 6.0, radius: 0.3, y: 0.45, damage: 1, offset: 0.4 },
  lightning: { warn: 0.85, length: 11, width: 0.8, beam: 0.5, lockBefore: 0.55, damage: 1 },
  roots: { warn: 1.0, radius: 1.0, damage: 1, hold: 0.6, count: [0, 3, 5] },
  summon: { warn: 0.55, max: 3, perCast: 2, cooldown: 11, dist: 2.6, variants: { 2: ['base', 'spitter'], 3: ['base', 'spitter', 'brute'] } },
  thorns: { warn: 0.8, radius: 0.75, count: [5, 6, 8], damage: 1, dropFrom: 3.6, fallTime: 0.16, linger: 0.35 },
  dash: { warn: 0.6, lockBefore: 0.22, width: 1.15, beam: 0.24, maxLen: 9 },
  wave: { speed: 5.2, width: 0.42, maxR: 9.5, damage: 1 },
  bunny: { hop: 0.36, step: 0.95, trigger: 0.7, life: 3.2, fuse: 0.55, radius: 1.1, damage: 1 },
  tauntChance: 0.28,
};

// ---- história: gancho com a Divonica ------------------------------------------------------------------
export const LINE_HOOK_1 = 'Aprendiz! Descobri por que os morangos andam sumindo: os Sombritos estão roubando todos e levando para o Druida Sombrio, lá no fundo da Floresta!';
export const LINE_HOOK_2 = 'Dizem que ele é um mago mal-humorado, com um coelhinho no chapéu. Ninguém sabe se o coelhinho é do bem.';
export const LINE_HOOK_3 = 'Sua magia de planta deve convencer as vinhas da barreira a abrirem. Vai lá recuperar os nossos morangos! Eu fico guardando o vale. E o lanche.';
export const OBJ_ENTER_FOREST = 'Entre na Floresta Sombria';
export const OBJ_STOLEN = 'Recupere os morangos roubados';
export const OBJ_BOSS = 'Derrote o Druida Sombrio';

export const LINES_DIVONICA_AFTER_HOOK = [
  'A barreira da Floresta fica no fim do caminho oeste. Leve a varinha, o Broto Guardião e muita coragem. Ah, e um lanchinho.',
  'Se aparecer um espinheiro no caminho, chame o Broto Guardião. Ele é um amor... com dentes.',
  'Aquele anel de cogumelos lá dentro dizem que cura o cansaço. Eu nunca fui. Prefiro o banquinho.',
];
export const LINES_DIVONICA_AFTER_BOSS = [
  'Você fez as pazes com o Druida?! Eu perdi o drama do século. Me conta tudo depois!',
  'Ouvi dizer que a clareira florescida está linda. Vou lá visitar, só pra olhar. E pegar um morango.',
  'A próxima barreira é a da Trilha das Brasas. Ela ainda está bem fechada... Em breve!',
];

// ---- barreira da Floresta -------------------------------------------------------------------------------
export const LINE_GATE_TRY = 'Barreira de runas... Vamos ver se a minha magia de planta convence vocês.';
export const LINE_GATE_OPEN = 'Funcionou! As vinhas se abriram. Só precisava pedir com carinho.';
export const PROMPT_GATE_ENTER = 'Entrar na Floresta Sombria';
export const PROMPT_GATE_OPEN_TRY = 'Usar a magia de planta';
export const LINE_FOREST_FIRST = 'Nossa, que escuro... Os morangos têm mesmo que ser escondidos em lugares assim?';
export const PROMPT_TO_VALE = 'Voltar ao Vale';

// ---- floresta -----------------------------------------------------------------------------------------------
export const HINT_BRAMBLE = 'Espinheiros bloqueiam o caminho... O Broto Guardião (Q) adora uma salada!';
export const HINT_BRAMBLE_NO_SPELL = 'Espinhos demais. Preciso de uma ajuda verde.';
export const TOAST_CHECKPOINT = 'Ponto de retorno salvo! Vida restaurada 🍄';
export const TOAST_STOLEN = (n, t) => `Morango roubado recuperado! ${n}/${t}`;
export const TOAST_STOLEN_ALL = 'Todos os morangos roubados! Agora é só cobrar o Druida.';
export const LINE_STOLEN_ALL = 'Oito morangos de volta! Faltam só as explicações.';
export const PROMPT_CHECKPOINT = 'Descansar no anel de cogumelos';

// ---- chefe: antes da luta (as três falas são as aprovadas: não mexer) ---------------------------------------
export const BOSS_NAME = 'Druida Sombrio';
export const INTRO_LINES = [
  { speaker: 'Druida', text: 'Quem ousa entrar na minha floresta?' },
  { speaker: 'Aprendiz', text: 'Os seus Sombritos roubaram os meus morangos!' },
  { speaker: 'Druida', text: 'Roubaram? Eles... pegaram emprestado. Pra sempre.' },
];

// ---- chefe: durante a luta ----------------------------------------------------------------------------------------
export const LINE_PHASE2 = 'Chega de brincadeira! Sombritos, venham cá!';
export const LINE_PHASE3 = 'Tá bom, tá bom... agora eu fiquei irritado!';
export const LINES_TAUNT = ['Ah, ah! Quase!', 'O coelhinho está torcendo por mim.', 'Isso foi só o aquecimento!', 'Hehe... fofa e teimosa.'];
export const HINT_FIGHT = 'Espaço esquiva · botão direito / K bloqueia · J ou clique ataca · Q chama o Broto Guardião';

// ---- chefe: depois da luta ----------------------------------------------------------------------------------------
export const OUTRO_LINES = [
  { speaker: 'Druida', text: 'Ai... você ganhou. E o meu chapéu agora tem um furinho de raio.' },
  { speaker: 'Aprendiz', text: 'Por que você roubou os morangos, afinal?' },
  { speaker: 'Druida', text: 'Aqui é tão escuro que nada cresce... nem uma florzinha. Os Sombritos só queriam algo docinho. Eu também, vai.' },
  { speaker: 'Aprendiz', text: 'Poxa... Então deixa eu tentar uma coisa.' },
];
export const OUTRO_AFTER_BLOOM = [
  { speaker: 'Druida', text: 'Eu não sabia que dava para ser bonito aqui. O coelhinho está chorando. De alegria. Eu acho.' },
  { speaker: 'Aprendiz', text: 'Quer dividir os morangos comigo? Tem um montão.' },
  { speaker: 'Druida', text: 'Se... se eu puder escolher os maiores, sim.' },
  { speaker: 'Aprendiz', text: 'Combinado!' },
];
export const TOAST_REWARD = '❤️ +1 coração de vida máxima!';
export const TOAST_PATH_FREE = 'O caminho de volta está livre!';
export const PROMPT_DRUID_CHAT = 'Conversar';
export const LINES_DRUID_FRIEND = [
  'O coelhinho agradece pelas flores. Eu também. Mas principalmente ele.',
  'Os Sombritos agora só pegam emprestado um morango por semana. Eles assinaram um papel.',
  'A próxima barreira é a da Trilha das Brasas. O Arcanista é... caloroso. Cuidado com o marshmallow.',
  'Depois que as flores nasceram, eu nem consigo mais ser mal-humorado. Que droga.',
];
