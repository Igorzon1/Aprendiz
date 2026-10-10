// Parâmetros de ajuste fino (sensação de jogo). Tudo em metros / segundos.

export const PLAYER = {
  radius: 0.2,
  height: 0.95,
  walkSpeed: 1.3,   // m/s: velocidade em que o clip Walk "não escorrega"
  runSpeed: 2.6,    // m/s: idem para o Run
  accel: 16,
  decel: 22,
  turnLambda: 14,   // suavidade da virada (maior = mais rápida)
  afkAfter: 12,     // s sem entrada até tocar o clip de AFK
  afkRepeat: 7,     // s entre repetições do clip de AFK
  attackCooldown: 0.55,
  hurtKnockback: 3.8,   // m/s do empurrão do hurt() (distância ~ v^2 / (2*decel))
  hurtLock: 0.1,        // s extras sem controle depois do clip Hit
  afkFallbackEvery: [9, 15], // s entre os "sustos" fofos do AFK sem brinquedo (clip ausente)
  // v0.4: esquiva (Espaço): rolamento no lugar do clip Dodge (14 quadros), o jogo desloca a Aprendiz.
  dodge: {
    distance: 2.4,        // m percorridos na esquiva (avanço rápido)
    duration: 12 / 30,    // s (= duração do clip Dodge)
    moveFrom: 0.5 / 30,   // s: o avanço começa na hora (sem agachar antes)
    moveTo: 9 / 30,       // s: termina (rápido no começo, freando no fim)
    iframes: 0.32,        // s de invencibilidade (evento iframes_end = quadro 10)
    cooldown: 0.6,        // s depois do fim do rolamento
    buffer: 0.18,         // s que o apertar do Espaço fica "guardado" se ela ainda não pode esquivar
  },
  // v0.4: escudo mágico (botão direito / K): bolha na frente dela.
  block: {
    speedMul: 0.4,        // fração da velocidade ao andar com o escudo
    coneCos: 0.5,         // cos(60°): bloqueia golpes vindos de um cone frontal de 120°
    radius: 0.62,         // m: raio da cúpula
    ahead: 0.36,          // m à frente do centro dela
    height: 0.46,         // m: altura do centro da cúpula
    hitHold: 0.16,        // s sem tomar outro "bloqueio" (evita faíscas em dobro)
  },
};

export const CAMERA = {
  fov: 38,
  // Enquadramento "tático" (zoom u = 0): visão 3/4 de cima, a de sempre.
  distance: 4.7,
  pitchDeg: 44,
  yawDeg: 0,
  aimHeight: 0.45,
  damping: 4.5,       // suavidade do foco no enquadramento tático (sobe até dampingPortrait no retrato)
  dampingPortrait: 9,
  lookAhead: 0.22,
  // Enquadramento "retrato" (zoom u = 1): rosto da Aprendiz.
  portrait: { distance: 1.75, pitchDeg: 16, aimHeight: 0.62, sideOffset: 0.12 },
  // Zoom contínuo u: -1 (afastado) .. 0 (tático) .. 1 (retrato). A roda move u em `zoomStep` por "clique".
  zoomStep: 0.085,
  zoomOutMax: 1.32,   // multiplicador da distância em u = -zoomOutRange
  zoomOutRange: 0.3,  // quanto u pode ficar negativo
  zoomLambda: 7,
  // Órbita com o botão do meio.
  orbitYawSpeed: 0.0062,     // rad por pixel
  orbitPitchSpeed: 0.0042,   // rad por pixel
  orbitLambda: 14,
  pitchMinDeg: 6,            // ao ar livre
  pitchMinIndoorDeg: 12,     // dentro de casa
  pitchMaxDeg: 72,
  indoorYawLimitDeg: 55,
  // Tomadas de câmera (cutscenes).
  shot: {
    lambda: 3.6,
    timeout: 3.5,            // s: a Promise resolve de qualquer jeito
    closeupApprentice: { distance: 1.8, pitchDeg: 12, aimHeight: 0.5, yawOffsetDeg: 18 },
    closeupCat: { distance: 0.8, pitchDeg: 15, aimHeight: 0.15, yawOffsetDeg: 24 },
    twoShot: { pitchDeg: 18, yawOffsetDeg: 30, aimHeight: 0.35, minDistance: 2.3, margin: 0.75 },
  },
  // Paredes que somem quando ficam entre a câmera e a Aprendiz.
  wall: { fadeOutLambda: 13, fadeInLambda: 5, holdBack: 0.35, minOpacity: 0, margin: 0.12 },
};

export const CAT = {
  radius: 0.1,       // colisão com a casa
  height: 0.28,
  navRadius: 0.14,
  walkSpeed: 1.0,    // m/s nominal do clip Walk (timeScale = velocidade / nominal)
  runSpeed: 2.2,     // idem Run
  runThreshold: 1.6, // velocidade pedida acima disso usa o clip Run
  minDist: 0.45,     // distância mínima entre gatos e entre gato e Aprendiz
  accel: 5,
  decel: 8,
  turnLambda: 9,
  // Brincadeira com o brinquedo/brilho (AFK)
  play: {
    lead: 0.28,         // s de antecipação do alvo
    leadMax: 0.55,      // m máximos de antecipação
    playerClear: 0.6,   // m: o gato não persegue para mais perto que isso da Aprendiz
    crouchFrame: 12.5,  // quadro do Pounce em que o corpo congela agachado (o salto é no 15)
    wiggleHz: 7.5,      // balanço do traseiro
    wiggleAmp: 0.11,    // rad
    lingerAfterToy: 1.3,// s procurando o brinquedo depois que ele some
  },
  // Inimigos
  threat: {
    keepAway: 2.5,      // m: distância mínima de qualquer inimigo
    margin: 0.5,        // folga ao escolher o ponto seguro
    startleRange: 3.4,  // m: dá o susto (Startled) uma vez quando um inimigo chega aqui
    startleCooldown: 10,
    awareRange: 9,      // m: dentro disso os gatos preferem ficar atrás da Aprendiz
  },
};

// Cores/intensidades de render
export const RENDER = {
  exposure: 1.0,
  background: '#7d6aa6',
  bloom: { strength: 0.32, radius: 0.45, threshold: 1.15 },
  sun: { color: '#ffe3bd', intensity: 1.7 },
  hemi: { sky: '#cfd8ff', ground: '#b88f78', intensity: 0.9 },
  pointLightScale: 1.0, // multiplicador das intensidades dos LIGHT_* (valores do Blender ~0.5-1.5 ficam em candelas do three)
};
