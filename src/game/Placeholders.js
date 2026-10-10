import * as THREE from 'three';

/**
 * Placeholders procedurais usados enquanto os .glb finais não existem.
 * Seguem as mesmas convenções do contrato (COL_*, INT_*, SPAWN_*, LIGHT_*, Fridge_*, Dummy)
 * para que o código do jogo use exatamente o mesmo caminho com assets reais ou falsos.
 */

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });

function addBox(parent, w, h, d, color, x, y, z, { name = '', extra } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(color, extra));
  m.position.set(x, y, z);
  if (name) m.name = name;
  parent.add(m);
  return m;
}

function addCol(parent, name, w, h, d, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: 0xff00ff, wireframe: true }));
  m.name = `COL_${name}`;
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function addEmpty(parent, name, x, y, z, userData = {}, yaw = 0) {
  const o = new THREE.Object3D();
  o.name = name;
  o.position.set(x, y, z);
  o.rotation.y = yaw;
  o.userData = userData;
  parent.add(o);
  return o;
}

const int = (parent, name, x, z, kind, prompt, radius) => addEmpty(parent, `INT_${name}`, x, 0, z, { kind, prompt, radius });

// ---------------------------------------------------------------------------------------------
// Casa
// ---------------------------------------------------------------------------------------------
export function buildPlaceholderHouse() {
  const house = new THREE.Group();
  house.name = 'House_Placeholder';

  const W = 6, D = 4.8; // interior: x -3..3, z -2.4..2.4. A frente (+Z) é aberta.
  const wall = '#f4e4d0', trim = '#d9b99a';

  // Chão e tapete
  addBox(house, W + 0.3, 0.1, D + 0.1, '#c99768', 0, -0.05, 0);
  const rug = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.012, 40), std('#e9a2b8'));
  rug.position.set(0, 0.006, 0.3);
  house.add(rug);
  const rug2 = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.014, 40), std('#fbd7e0'));
  rug2.position.set(0, 0.007, 0.3);
  house.add(rug2);

  // Paredes (fundo e laterais) + rodapé
  addBox(house, W + 0.3, 2.6, 0.15, wall, 0, 1.3, -D / 2 - 0.075, { name: 'Wall_Back' });
  addBox(house, 0.15, 2.6, D + 0.1, wall, -W / 2 - 0.075, 1.3, 0, { name: 'Wall_Left' });
  addBox(house, 0.15, 2.6, D + 0.1, wall, W / 2 + 0.075, 1.3, 0, { name: 'Wall_Right' });
  addBox(house, W, 0.14, 0.04, trim, 0, 0.07, -D / 2 + 0.02);
  addBox(house, 0.04, 0.14, D, trim, -W / 2 + 0.02, 0.07, 0);
  addBox(house, 0.04, 0.14, D, trim, W / 2 - 0.02, 0.07, 0);
  addCol(house, 'WallBack', W + 0.3, 2.6, 0.15, 0, 1.3, -D / 2 - 0.075);
  addCol(house, 'WallLeft', 0.15, 2.6, D + 0.1, -W / 2 - 0.075, 1.3, 0);
  addCol(house, 'WallRight', 0.15, 2.6, D + 0.1, W / 2 + 0.075, 1.3, 0);

  // Janela (parede de fundo)
  addBox(house, 1.1, 1.1, 0.06, '#ffffff', 0.9, 1.55, -D / 2 + 0.03);
  addBox(house, 0.9, 0.9, 0.02, '#bfe0ff', 0.9, 1.55, -D / 2 + 0.07, { extra: { emissive: new THREE.Color('#9fd0ff'), emissiveIntensity: 1.6 } });
  addBox(house, 0.05, 0.9, 0.03, '#ffffff', 0.9, 1.55, -D / 2 + 0.09);
  addBox(house, 0.9, 0.05, 0.03, '#ffffff', 0.9, 1.55, -D / 2 + 0.09);
  int(house, 'Window', 0.9, -D / 2 + 0.55, 'window', 'Olhar pela janela', 1.1);

  // Porta da frente (parede ESQUERDA, perto da frente da casa) com portinhola de gato
  const doorZ = 1.45;
  addBox(house, 0.06, 1.75, 0.95, '#8a5a3b', -W / 2 + 0.03, 0.875, doorZ, { name: 'Door' });
  addBox(house, 0.07, 0.08, 0.08, '#f2c14e', -W / 2 + 0.08, 0.9, doorZ + 0.3);
  int(house, 'Door', -W / 2 + 0.35, doorZ, 'door', 'Sair de casa', 1.1);
  // Portinhola: pivô na dobradiça de cima; balança em torno do eixo Z (parede com normal em X).
  const flap = new THREE.Group();
  flap.name = 'CatFlap';
  flap.position.set(-W / 2 + 0.075, 0.34, doorZ - 0.05);
  flap.userData = { swing_axis: 'z', swing_angle_deg: 65 };
  addBox(flap, 0.03, 0.26, 0.22, '#f2c14e', 0, -0.13, 0);
  house.add(flap);
  addBox(house, 0.02, 0.3, 0.28, '#5b3a26', -W / 2 + 0.06, 0.19, doorZ - 0.05); // moldura
  // Pequeno deque lá fora (para o Petico não flutuar no vazio)
  addBox(house, 1.8, 0.1, 1.8, '#a8d18a', -W / 2 - 1.1, -0.05, doorZ);
  addEmpty(house, 'PATH_CatOutside', -W / 2 - 1.5, 0, doorZ - 0.05);
  addEmpty(house, 'PATH_CatFlapIn', -W / 2 + 0.6, 0, doorZ - 0.05);
  addEmpty(house, 'SPAWN_PeticoReturn', -W / 2 - 1.5, 0, doorZ - 0.05, {}, Math.PI / 2);

  // Cama (encostada na parede esquerda, ao fundo)
  const bx = -2.35, bz = -1.35;
  addBox(house, 1.1, 0.3, 2.0, '#9b6a4a', bx, 0.15, bz);
  addBox(house, 1.0, 0.2, 1.9, '#f7bccb', bx, 0.4, bz);
  addBox(house, 0.7, 0.12, 0.38, '#ffffff', bx, 0.56, bz - 0.7);
  addBox(house, 1.02, 0.07, 1.0, '#a3d9cc', bx, 0.52, bz + 0.3);
  addBox(house, 1.1, 0.7, 0.08, '#8a5a3b', bx, 0.65, bz - 1.0);
  addCol(house, 'Bed', 1.1, 0.6, 2.0, bx, 0.3, bz);
  int(house, 'Bed', bx, bz, 'bed', 'Descansar', 1.5);

  // Estante de livros
  const sx = -0.7, sz = -D / 2 + 0.2;
  addBox(house, 1.3, 1.9, 0.35, '#8a5a3b', sx, 0.95, sz);
  const bookColors = ['#e4577a', '#58a6e8', '#f2c14e', '#7bd0a5', '#b58bea', '#ff9a62'];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 7; i++) {
      const h = 0.28 + ((i * 7 + row * 3) % 4) * 0.03;
      addBox(house, 0.1, h, 0.24, bookColors[(i + row * 2) % bookColors.length], sx - 0.5 + i * 0.16, 0.2 + row * 0.55 + h / 2 + 0.12, sz + 0.06);
    }
  }
  addCol(house, 'Bookshelf', 1.3, 1.9, 0.35, sx, 0.95, sz);
  int(house, 'Bookshelf', sx, sz, 'bookshelf', 'Ler os livros', 1.4);

  // Caldeirão
  const cx = 0.3, cz = -1.65;
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.3, 0.5, 20), std('#3b3a4f'));
  pot.position.set(cx, 0.28, cz);
  house.add(pot);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.04, 8, 24), std('#2c2b3d'));
  rim.rotation.x = Math.PI / 2;
  rim.position.set(cx, 0.53, cz);
  house.add(rim);
  const brew = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.01, 20), std('#6cff9a', { emissive: new THREE.Color('#40ff80'), emissiveIntensity: 2.2 }));
  brew.position.set(cx, 0.5, cz);
  house.add(brew);
  addCol(house, 'Cauldron', 0.8, 0.55, 0.8, cx, 0.28, cz);
  int(house, 'Cauldron', cx, cz, 'cauldron', 'Mexer o caldeirão', 1.3);

  // Mesa com planta
  const tx = -1.2, tz = 1.1;
  addBox(house, 0.9, 0.06, 0.9, '#b98a5e', tx, 0.5, tz);
  for (const [lx, lz] of [[-0.38, -0.38], [0.38, -0.38], [-0.38, 0.38], [0.38, 0.38]]) addBox(house, 0.06, 0.47, 0.06, '#9b6a4a', tx + lx, 0.235, tz + lz);
  const pl = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), std('#6bbf6a'));
  pl.position.set(tx, 0.7, tz);
  house.add(pl);
  addBox(house, 0.16, 0.14, 0.16, '#d97a5a', tx, 0.6, tz);
  addCol(house, 'Table', 0.9, 0.55, 0.9, tx, 0.275, tz);

  // Geladeira (canto direito do fundo). Frente voltada para +Z.
  const fx = 2.3, fw = 0.8, fh = 1.7, fd = 0.75;
  const fz = -D / 2 + fd / 2; // centro
  const fridge = new THREE.Group();
  fridge.name = 'Fridge';
  const body = '#bfe9d9';
  addBox(fridge, fw, fh, 0.04, body, fx, fh / 2, fz - fd / 2 + 0.02);                 // fundo
  addBox(fridge, 0.04, fh, fd, body, fx - fw / 2 + 0.02, fh / 2, fz);                // lado esq
  addBox(fridge, 0.04, fh, fd, body, fx + fw / 2 - 0.02, fh / 2, fz);                // lado dir
  addBox(fridge, fw, 0.05, fd, body, fx, fh - 0.025, fz);                            // topo
  addBox(fridge, fw, 0.08, fd, body, fx, 0.04, fz);                                  // base
  addBox(fridge, fw - 0.08, 0.02, fd - 0.1, '#e8f6f1', fx, 0.62, fz - 0.03);         // prateleiras
  addBox(fridge, fw - 0.08, 0.02, fd - 0.1, '#e8f6f1', fx, 1.12, fz - 0.03);
  // luz interna (painel emissivo)
  const light = addBox(fridge, 0.5, 0.02, 0.22, '#ffffff', fx, fh - 0.07, fz - 0.05, { name: 'Fridge_Light', extra: { emissive: new THREE.Color('#fff6f0'), emissiveIntensity: 2.0 } });
  void light;
  // morangos
  const berries = new THREE.Group();
  berries.name = 'Fridge_Strawberries';
  const berryMat = std('#ff3b5c', { emissive: new THREE.Color('#ff2040'), emissiveIntensity: 0.15 });
  const berryGeo = new THREE.SphereGeometry(0.045, 10, 8);
  const rows = [0.64, 1.14];
  rows.forEach((y, r) => {
    for (let i = 0; i < 7; i++) {
      const b = new THREE.Mesh(berryGeo, berryMat);
      b.scale.set(1, 1.15, 1);
      b.position.set(fx - 0.27 + i * 0.09, y + 0.05 + (i % 2) * 0.01, fz - 0.12 + (i % 3) * 0.1 + r * 0.02);
      berries.add(b);
    }
  });
  fridge.add(berries);
  // porta: nó com origem na dobradiça (aresta esquerda da frente)
  const hinge = new THREE.Group();
  hinge.name = 'Fridge_Door';
  hinge.position.set(fx - fw / 2, 0, fz + fd / 2);
  hinge.userData = { open_angle_deg: -105 };
  addBox(hinge, fw, fh - 0.04, 0.05, '#9be0c8', fw / 2, fh / 2, 0.025);
  addBox(hinge, 0.04, 0.5, 0.05, '#e9eef0', fw - 0.1, fh * 0.62, 0.07);
  fridge.add(hinge);
  house.add(fridge);
  addCol(house, 'Fridge', fw, fh, fd, fx, fh / 2, fz);
  int(house, 'Fridge', fx, fz, 'fridge', 'Abrir geladeira', 1.5);

  // Boneco de treino (origem na base)
  const dx = 1.6, dz = 1.2;
  const dummy = new THREE.Group();
  dummy.name = 'Dummy';
  dummy.position.set(dx, 0, dz);
  const dbase = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.06, 16), std('#8a5a3b'));
  dbase.position.y = 0.03;
  dummy.add(dbase);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.75, 8), std('#9b6a4a'));
  post.position.y = 0.4;
  dummy.add(post);
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.4, 14), std('#e8cf8a'));
  torso.position.y = 0.72;
  dummy.add(torso);
  const arms = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8), std('#9b6a4a'));
  arms.rotation.z = Math.PI / 2;
  arms.position.y = 0.8;
  dummy.add(arms);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 12), std('#f0d9a0'));
  head.position.y = 1.07;
  dummy.add(head);
  const eyeMat = std('#3b2f2f');
  for (const sx2 of [-0.05, 0.05]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), eyeMat);
    e.position.set(sx2, 1.1, 0.14);
    dummy.add(e);
  }
  const target = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 20), std('#e4577a'));
  target.rotation.x = Math.PI / 2;
  target.position.set(0, 0.74, 0.2);
  dummy.add(target);
  house.add(dummy);
  addCol(house, 'Dummy', 0.45, 1.2, 0.45, dx, 0.6, dz);
  int(house, 'Dummy', dx, dz, 'dummy', 'Treinar feitiços', 1.9);

  // Spawns
  addEmpty(house, 'SPAWN_Player', -1.3, 0, -0.9, {}, 0);
  addEmpty(house, 'SPAWN_Yumi', -1.5, 0, 0.1, {}, 0.6);
  addEmpty(house, 'SPAWN_Petico', -2.3, 0, 0.0, {}, -0.4);

  // Luzes
  addEmpty(house, 'LIGHT_Lamp', -0.4, 2.0, 0.3, { color: '#ffd7a3', intensity: 1.4, distance: 7 });
  addEmpty(house, 'LIGHT_Window', 0.9, 1.6, -1.7, { color: '#a9ccff', intensity: 0.7, distance: 4.5 });
  addEmpty(house, 'LIGHT_Cauldron', cx, 0.9, cz + 0.1, { color: '#7dffb0', intensity: 0.6, distance: 3 });
  addEmpty(house, 'LIGHT_Bed', bx + 0.6, 1.1, bz + 0.4, { color: '#ffb7d0', intensity: 0.5, distance: 3 });

  house.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return house;
}

// ---------------------------------------------------------------------------------------------
// Gato placeholder (animação procedural)
// ---------------------------------------------------------------------------------------------
/** Anima o gato falso conforme o nome do clip lógico atual (Walk, Sit_Idle, Groom...). */
class CatRig {
  constructor(parts) {
    this.p = parts;
    this.clip = 'Idle';
    this.t = 0;
    this.phase = 0;
    this.speed = 0;
    this.clipTime = 0;
  }

  play(name) { this.clip = name; this.clipTime = 0; }

  update(dt) {
    const p = this.p;
    this.t += dt;
    this.clipTime += dt;
    const c = this.clip;
    const moving = c === 'Walk' || c === 'Run';
    const freq = c === 'Run' ? 15 : 9;
    if (moving) this.phase += dt * freq * Math.max(0.5, Math.min(1.6, this.speed / (c === 'Run' ? 1.7 : 0.6)));

    let bodyY = 0, pitch = 0, headPitch = 0, tailRot = Math.sin(this.t * 2.2) * 0.35, scaleY = 1 + Math.sin(this.t * 2.5) * 0.015;
    let legSwing = 0, sit = 0;
    if (moving) {
      legSwing = Math.sin(this.phase) * (c === 'Run' ? 0.9 : 0.55);
      bodyY = Math.abs(Math.sin(this.phase)) * (c === 'Run' ? 0.03 : 0.012);
    }
    switch (c) {
      case 'SitDown': sit = Math.min(1, this.clipTime / 0.6); break;
      case 'Sit_Idle': sit = 1; headPitch = Math.sin(this.t * 1.1) * 0.12; break;
      case 'StandUp': sit = Math.max(0, 1 - this.clipTime / 0.6); break;
      case 'Groom': sit = 1; headPitch = 0.7 + Math.sin(this.t * 9) * 0.18; break;
      case 'Stretch': pitch = 0.35 + Math.sin(this.clipTime * 2) * 0.05; bodyY = -0.03; break;
      case 'Pounce': pitch = -0.4; bodyY = Math.max(0, Math.sin(Math.min(1, this.clipTime / 0.7) * Math.PI)) * 0.08; break;
      case 'Meow': headPitch = -0.45; break;
      case 'Purr': sit = 0.6; scaleY = 1 + Math.sin(this.t * 40) * 0.02; break;
      case 'Startled': bodyY = Math.max(0, Math.sin(Math.min(1, this.clipTime / 0.4) * Math.PI)) * 0.1; scaleY = 1.12; break;
      default: break;
    }
    p.body.position.y = 0.13 + bodyY - sit * 0.035;
    p.body.rotation.x = pitch - sit * 0.55;
    p.body.scale.y = scaleY;
    p.head.rotation.x = headPitch;
    p.tail.rotation.z = tailRot;
    p.legs.forEach((leg, i) => {
      const s = (i === 0 || i === 3) ? 1 : -1;
      leg.rotation.x = legSwing * s * (1 - sit) + sit * (i < 2 ? 0 : -1.2);
    });
  }
}

export function buildPlaceholderCat(colorHex) {
  const g = new THREE.Group();
  g.name = 'CatPlaceholder';
  const mat = std(colorHex);
  const dark = std('#2b2433');
  const pink = std('#f5a3b6');

  const body = new THREE.Group();
  g.add(body);
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), mat);
  torso.scale.set(0.95, 0.85, 1.3);
  body.add(torso);

  const head = new THREE.Group();
  head.position.set(0, 0.07, 0.12);
  body.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), mat);
  head.add(skull);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.06, 4), mat);
    ear.position.set(s * 0.05, 0.075, -0.005);
    head.add(ear);
    const inner = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.035, 4), pink);
    inner.position.set(s * 0.05, 0.072, 0.008);
    head.add(inner);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.013, 8, 6), dark);
    eye.position.set(s * 0.032, 0.014, 0.065);
    head.add(eye);
  }
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 5), pink);
  nose.position.set(0, -0.01, 0.073);
  head.add(nose);

  const tail = new THREE.Group();
  tail.position.set(0, 0.03, -0.12);
  body.add(tail);
  const tailMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.14, 4, 8), mat);
  tailMesh.position.set(0, 0.07, -0.03);
  tailMesh.rotation.x = -0.6;
  tail.add(tailMesh);

  const legs = [];
  for (const [lx, lz] of [[-0.05, 0.07], [0.05, 0.07], [-0.05, -0.07], [0.05, -0.07]]) {
    const pivot = new THREE.Group();
    pivot.position.set(lx, 0.02, lz);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.08, 3, 6), mat);
    leg.position.y = -0.065 + 0.02;
    pivot.add(leg);
    body.add(pivot);
    legs.push(pivot);
  }
  // as pernas ficam no corpo; compensa a altura para os pés tocarem o chão
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { scene: g, rig: new CatRig({ body, head, tail, legs }) };
}

// ---------------------------------------------------------------------------------------------
// Aprendiz placeholder
// ---------------------------------------------------------------------------------------------
class ApprenticeRig {
  constructor(parts) { this.p = parts; this.clip = 'Idle'; this.t = 0; this.phase = 0; this.speed = 0; this.clipTime = 0; }
  play(name) { this.clip = name; this.clipTime = 0; }
  update(dt) {
    const p = this.p;
    this.t += dt;
    this.clipTime += dt;
    const moving = this.clip === 'Walk' || this.clip === 'Run';
    if (moving) this.phase += dt * (this.clip === 'Run' ? 13 : 8);
    p.body.position.y = moving ? Math.abs(Math.sin(this.phase)) * 0.04 : Math.sin(this.t * 2) * 0.006;
    p.body.rotation.z = moving ? Math.sin(this.phase) * 0.06 : 0;
    let arm = 0;
    if (this.clip === 'Attack_Basic') arm = -1.6 * Math.min(1, this.clipTime / 0.25);
    else if (this.clip === 'Interact') arm = -1.0;
    p.wand.rotation.x = arm;
    p.body.scale.y = this.clip === 'WakeUp' ? 0.9 + 0.1 * Math.min(1, this.clipTime / 1.5) : 1;
  }
}

export function buildPlaceholderApprentice() {
  const g = new THREE.Group();
  g.name = 'ApprenticePlaceholder';
  const body = new THREE.Group();
  g.add(body);
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.45, 14), std('#6b4fbf'));
  robe.position.y = 0.25;
  body.add(robe);
  const head = new THREE.Group();
  head.name = 'head';
  head.position.y = 0.52;
  body.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), std('#ffd9c0')));
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 14), std('#4a3490'));
  hat.position.y = 0.2;
  head.add(hat);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.02, 20), std('#4a3490'));
  brim.position.y = 0.09;
  head.add(brim);
  const wand = new THREE.Group();
  wand.position.set(-0.17, 0.32, 0.05);
  body.add(wand);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 6), std('#8a5a3b'));
  stick.rotation.x = Math.PI / 2;
  stick.position.z = 0.15;
  stick.name = 'SM_Wand';
  wand.add(stick);
  const tip = new THREE.Object3D();
  tip.name = 'fx_light';
  tip.position.set(0, 0, 0.31);
  wand.add(tip);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { scene: g, rig: new ApprenticeRig({ body, wand }) };
}
