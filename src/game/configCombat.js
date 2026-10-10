// Parâmetros de ajuste fino do combate leve (v0.2). Tudo em metros / segundos.

/** A Aprendiz. */
export const VITALS = {
  maxHp: 5,
  invulnerable: 1.0,      // s de invencibilidade depois de levar um golpe
  blinkEvery: 0.08,       // s entre um "pisca" e outro durante a invencibilidade
  defeatMaxWait: 2.6,     // s esperando o clip Defeat terminar (a Promise de player.defeat())
  defeatHold: 0.7,        // s caída no chão antes do fade
  fadeMs: 600,
};

/** Sombrito (ShadowMinion.glb). */
export const SOMBRITO = {
  hp: 3,
  radius: 0.17,           // colisão com o mundo e entre eles
  height: 0.45,           // altura do modelo (para colisão com caixas baixas e teste dos raios)
  centerY: 0.22,          // altura do "centro" (alvo da mira)
  modelScale: 1,

  // movimento (m/s)
  wanderSpeed: 0.7,
  chaseSpeed: 1.6,
  leashSpeed: 1.5,
  walkNominal: 0.9,       // velocidade em que o clip Walk "não escorrega" (timeScale = v / nominal)
  accel: 9,
  decel: 14,
  turnLambda: 11,

  // percepção
  notice: 4.5,            // m: distância em que ele percebe a Aprendiz
  noticeTerritoryPad: 2,  // m: ela também precisa estar a no máximo `territory + pad` do ponto de origem
  alertMin: 0.45,         // s mínimos no estado ALERT (clip Alert ausente)
  alertMax: 0.9,          // s máximos no estado ALERT
  territoryDefault: 4,    // m, se o nó ENEMY_* não trouxer `territory`
  leashDist: 9,           // m: a Aprendiz fugiu para além disso -> ele desiste
  leashFromSpawn: 10,     // m além do território: desiste se estiver longe demais de casa

  // ataque
  attackRange: 0.75,      // m: começa o ataque
  holdRange: 0.6,         // m: para de se aproximar (fica "encarando")
  hitRange: 0.9,          // m: no evento `hit` ainda precisa estar tão perto
  hitCone: 0.25,          // cosseno mínimo entre a frente dele e a direção da Aprendiz (~75°)
  attackCooldown: 1.7,    // s depois do fim do clip Attack
  damage: 1,
  lunge: 1.6,             // m/s de "bote" no instante do golpe

  // reação ao dano
  knockback: 3.4,         // m/s iniciais (decai rápido)
  hurtStun: 0.42,         // s
  flash: 6,               // velocidade do clarão branco (1/s)

  // vida longa
  respawnDelay: 45,       // s depois de morrer
  respawnMinPlayerDist: 14, // m: só renasce com a Aprendiz longe
  separation: 0.5,        // m: alcance do empurrão suave entre inimigos
  minDist: 0.36,          // m: distância mínima dura entre inimigos
  playerKeepOff: 0.5,     // m: empurrão suave para não atravessar a Aprendiz

  // idle / passeio
  idleMin: 1.2,
  idleMax: 3.6,
  blinkMin: 3,
  blinkMax: 6.5,
  wanderRadiusK: 0.8,     // fração do território usada nos passeios
};

/** Mira assistida da bolinha mágica. */
export const AIM = {
  enemyRange: 5,          // m
  coneKey: 0.61,          // rad (~35°) com o teclado
  coneMouse: 0.17,        // rad (~10°) com o mouse (a Aprendiz já olha para o ponteiro)
  maxDy: 0.25,            // m: limite vertical da correção (sem ficar íngreme)
};

/** Raio e altura usados para saber se uma bolinha encostou num inimigo. */
export const BOLT_HIT = {
  padXZ: 0.05,
  minY: -0.15,
  maxY: 1.1,
};
