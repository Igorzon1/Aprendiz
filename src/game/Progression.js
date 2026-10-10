// Flags de progressão da partida e a varinha.
//
// v0.1: a Aprendiz começa SEM varinha (state.flags.hasWand = false). Enquanto for false:
//   - a varinha fica escondida (applyWandVisibility);
//   - o ataque básico não faz nada, só a fala "Sem a minha varinha não dá..." (com cooldown);
//   - o boneco de treino só comenta.
// Para testar: ?wand=1 na URL, ou F2 no modo dev (installDevWandShortcut).
// v0.2: a menina da rua chama giveWand(state, wand, { scene }) numa cutscene.

import * as THREE from 'three';

export const LINE_NO_WAND_ATTACK = 'Sem a minha varinha não dá...';
export const LINE_NO_WAND_DUMMY = 'Preciso de uma varinha pra treinar...';

// Estado da partida. `flags` é onde ficam as marcas (hasWand etc.).
export function createGameState() {
  const devWand = new URLSearchParams(location.search).get('wand') === '1';
  return { flags: { hasWand: devWand } };
}

// Malha da varinha: nome contém "Wand" mas não "WandLight" (a luz da ponta é outro objeto).
export function isWandMesh(obj) {
  return /Wand/.test(obj.name) && !/WandLight/.test(obj.name);
}

export function findWandMeshes(root) {
  const found = [];
  root.traverse((obj) => {
    if (isWandMesh(obj)) found.push(obj);
  });
  return found;
}

// Mostra ou esconde as varinhas de acordo com a flag.
export function applyWandVisibility(state, wands) {
  for (const w of wands) w.visible = state.flags.hasWand;
}

// Gate do ataque básico. Devolve true se pode atacar.
// Sem varinha, mostra a fala no máximo a cada `cooldownMs` (não faz spam).
export function createWandGate(state, ui, { cooldownMs = 2500 } = {}) {
  let lastSay = -Infinity;
  return {
    canCast(now = performance.now()) {
      if (state.flags.hasWand) return true;
      if (now - lastSay >= cooldownMs) {
        lastSay = now;
        ui.say(LINE_NO_WAND_ATTACK, { duration: 2000 });
      }
      return false;
    },
  };
}

// Interação com o boneco de treino. Sem varinha, só comenta. Devolve true se pode treinar.
export function canTrainOnDummy(state, ui) {
  if (state.flags.hasWand) return true;
  ui.say(LINE_NO_WAND_DUMMY, { duration: 2600 });
  return false;
}

// Dev: F2 liga/desliga a varinha. Só funciona com o servidor de desenvolvimento.
// Devolve uma função que remove o atalho.
export function installDevWandShortcut(state, wands, onChange) {
  if (!import.meta.env?.DEV) return () => {};
  const onKey = (e) => {
    if (e.key !== 'F2' || e.repeat) return;
    e.preventDefault();
    state.flags.hasWand = !state.flags.hasWand;
    applyWandVisibility(state, wands);
    onChange?.(state.flags.hasWand);
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

// Entrega a varinha: marca a flag, mostra a(s) malha(s) com um pop e uma faísca.
// Devolve uma Promise que resolve quando o pop termina.
export function giveWand(state, wands, { scene, duration = 450 } = {}) {
  state.flags.hasWand = true;
  const list = Array.isArray(wands) ? wands : [wands];
  const targets = list.map((obj) => ({ obj, scale: obj.scale.clone() }));
  for (const t of targets) {
    t.obj.visible = true;
    t.obj.scale.setScalar(0.001);
  }
  if (scene && list[0]) sparkle(scene, list[0]);

  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, Math.max(0, (now - t0) / duration));
      const e = easeOutBack(k);
      for (const t of targets) {
        t.obj.scale.copy(t.scale).multiplyScalar(Math.max(0.001, e));
      }
      if (k < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

function easeOutBack(k) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (k - 1) ** 3 + c1 * (k - 1) ** 2;
}

const SPARK_COLORS = [0xFFF6E6, 0xE0AE45, 0xCFA9E6];

// Faísca: pequenos losangos que saltam do ponto da varinha e somem.
function sparkle(scene, anchor, count = 12, life = 700) {
  const origin = new THREE.Vector3();
  anchor.getWorldPosition(origin);
  const geo = new THREE.OctahedronGeometry(0.035);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: SPARK_COLORS[i % SPARK_COLORS.length],
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin);
    const a = (i / count) * Math.PI * 2;
    const vel = new THREE.Vector3(Math.cos(a) * 0.9, 0.6 + Math.random() * 0.6, Math.sin(a) * 0.9);
    scene.add(mesh);
    parts.push({ mesh, mat, vel });
  }

  const t0 = performance.now();
  let last = t0;
  const step = (now) => {
    const k = (now - t0) / life;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (const p of parts) {
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - 2.5 * dt);
      p.mat.opacity = Math.max(0, 1 - k);
    }
    if (k < 1) {
      requestAnimationFrame(step);
    } else {
      for (const p of parts) {
        scene.remove(p.mesh);
        p.mat.dispose();
      }
      geo.dispose();
    }
  };
  requestAnimationFrame(step);
}
