import * as THREE from 'three';
import { PURPLE_PALETTE } from './CombatFx.js';
import { BOSS } from './configForest.js';
import { softTexture } from './Fx.js';
import { angleDiff, clamp, easeOutBack, rand, smoothstep } from './util.js';

// Ataques do Druida Sombrio: Esfera Sombria (projétil lento que persegue), Raio Negro (linha de aviso e depois o feixe),
// Raízes Sombrias (círculos roxos de aviso e depois as raízes) e os sigilos da invocação. Tudo com aviso antes, e todos os
// golpes passam por PlayerVitals.hit (esquiva = invencibilidade, escudo = bloqueio frontal).
// Os efeitos são malhas simples com mistura aditiva (brilham com o bloom) e um objeto de controle por ataque.

const WARN = new THREE.Color(1.9, 0.16, 0.42);      // aviso do raio: vermelho (destaca do chão roxo)
const WARN_ROOTS = new THREE.Color(1.8, 0.22, 1.2); // aviso das raízes: rosa-magenta
const WARN_SIGIL = new THREE.Color(0.9, 1.3, 2.6);  // sigilo da invocação: azul-arroxeado
const BEAM = new THREE.Color(1.5, 0.55, 1.9);
const BEAM_CORE = new THREE.Color(2.4, 1.9, 2.6);
const ORB_GLOW = new THREE.Color(1.7, 0.55, 2.7);
const DIRT = [[0.3, 0.2, 0.42], [0.45, 0.28, 0.6], [0.22, 0.14, 0.32]];

let _edgeTex = null;
function edgeTexture() {
  if (_edgeTex) return _edgeTex;
  const c = document.createElement('canvas');
  c.width = 32; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(0, 0, 32, 128);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.fillRect(0, 0, 3, 128);
  g.fillRect(29, 0, 3, 128);
  g.fillStyle = 'rgba(255,255,255,0.25)';
  for (let y = 0; y < 128; y += 16) g.fillRect(0, y, 32, 4);        // listras de perigo
  _edgeTex = new THREE.CanvasTexture(c);
  _edgeTex.colorSpace = THREE.SRGBColorSpace;
  return _edgeTex;
}

const addMat = (color, opacity, map = null) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, map, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
});

export class BossAttacks {
  /** @param {import('./Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.items = [];
    this.onResult = null;      // (kind: 'hurt'|'dodged'|'blocked'|'invuln') => void

    // geometrias compartilhadas
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    plane.translate(0, 0, 0.5);                         // começa em z = 0 e segue em +Z
    this.linePlane = plane;
    this.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    this.ringGeo = new THREE.RingGeometry(0.9, 1.0, 44).rotateX(-Math.PI / 2);
    this.discGeo = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
    this.coneGeo = new THREE.ConeGeometry(0.13, 1, 5).translate(0, 0.5, 0);
    this.sphereGeo = new THREE.SphereGeometry(1, 14, 10);
    this.rootMat = new THREE.MeshStandardMaterial({ color: '#2a1840', roughness: 0.8, emissive: '#3b1370', emissiveIntensity: 0.6 });
    this.tipMat = new THREE.MeshBasicMaterial({ color: ROOT_TIP(), toneMapped: false });
    this.orbCoreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.18, 0.04, 0.3) });
    this.orbShellMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.3, 1.6), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.orbGlowMat = new THREE.SpriteMaterial({ map: softTexture(), color: ORB_GLOW, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  }

  get vitals() { return this.game.vitals; }
  get player() { return this.game.player; }

  _result() {
    const k = this.vitals.lastResult;
    this.onResult?.(k);
    return k;
  }

  /** Há algum ataque em andamento? */
  get busy() { return this.items.length > 0; }

  clear() {
    for (const it of this.items) it.dispose();
    this.items.length = 0;
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.update(dt) === false) { it.dispose(); this.items.splice(i, 1); }
    }
  }

  _add(it) { this.items.push(it); return it; }

  // -----------------------------------------------------------------------------------------------
  // Esfera Sombria
  // -----------------------------------------------------------------------------------------------
  /** Esfera que persegue devagar. `yaw` = direção inicial (rad; frente = (sin, cos)). */
  orb(x, y, z, yaw) {
    const g = this.game, B = BOSS.orb;
    const group = new THREE.Group();
    const core = new THREE.Mesh(this.sphereGeo, this.orbCoreMat);
    core.scale.setScalar(0.17);
    const shell = new THREE.Mesh(this.sphereGeo, this.orbShellMat);
    shell.scale.setScalar(0.25);
    const glow = new THREE.Sprite(this.orbGlowMat);
    glow.scale.setScalar(1.0);
    group.add(core, shell, glow);
    group.position.set(x, y, z);
    g.scene.add(group);
    const o = {
      group, shell, glow, yaw, t: 0, trail: 0, y0: y, dead: false, born: 0,
      update: (dt) => this._updateOrb(o, dt),
      dispose: () => { group.parent?.remove(group); },
    };
    g.sparkles.burst(x, y, z, 12, { speed: 1.4, life: 0.5, size: 0.07, gravity: 0, palette: PURPLE_PALETTE });
    return this._add(o);
  }

  _updateOrb(o, dt) {
    const g = this.game, B = BOSS.orb, p = this.player;
    o.t += dt;
    if (o.t > B.life) { this._popOrb(o); return false; }
    const pos = o.group.position;
    // persegue devagar: gira no máximo B.turn rad/s em direção a ela
    if (!p.defeated) {
      const want = Math.atan2(p.pos.x - pos.x, p.pos.z - pos.z);
      const d = angleDiff(o.yaw, want);
      o.yaw += clamp(d, -B.turn * dt, B.turn * dt);
    }
    const sp = B.speed * (o.t < 0.35 ? 0.4 + 1.7 * (o.t / 0.35) : 1);          // arranca devagar
    pos.x += Math.sin(o.yaw) * sp * dt;
    pos.z += Math.cos(o.yaw) * sp * dt;
    pos.y += (B.y - pos.y) * Math.min(1, dt * 3);
    const pulse = 1 + 0.12 * Math.sin(o.t * 14);
    o.shell.scale.setScalar(0.25 * pulse);
    o.glow.scale.setScalar(0.9 * pulse);
    o.trail -= dt;
    while (o.trail <= 0) {
      o.trail += 0.035;
      const c = PURPLE_PALETTE[(Math.random() * PURPLE_PALETTE.length) | 0];
      g.sparkles.emit({ x: pos.x + rand(-0.06, 0.06), y: pos.y + rand(-0.06, 0.06), z: pos.z + rand(-0.06, 0.06), vx: rand(-0.2, 0.2), vy: rand(0, 0.3), vz: rand(-0.2, 0.2), life: rand(0.35, 0.6), size: rand(0.05, 0.09), r: c[0], g: c[1], b: c[2], gravity: -0.3, drag: 2 });
    }
    if (g.collision.pointBlocked(pos.x, pos.y, pos.z, 0.05)) { this._popOrb(o); return false; }
    // acerta a Aprendiz?
    if (!p.defeated && Math.hypot(p.pos.x - pos.x, p.pos.z - pos.z) < B.radius + 0.18 && Math.abs(pos.y - 0.45) < 0.7) {
      this.vitals.hit(B.damage, pos.x, pos.z);
      const k = this._result();
      if (k === 'hurt' || k === 'blocked') { this._popOrb(o); return false; }
    }
    return true;
  }

  _popOrb(o) {
    const p = o.group.position;
    this.game.sparkles.burst(p.x, p.y, p.z, 22, { speed: 2.2, life: 0.6, size: 0.08, gravity: -0.6, palette: PURPLE_PALETTE });
    this.game.puffs?.puff(p.x, p.y, p.z, { colors: ['#52307a', '#6a3f95'], count: 4, scale: 0.7, life: 0.45 });
  }

  // -----------------------------------------------------------------------------------------------
  // Raio Negro: linha de aviso -> feixe
  // -----------------------------------------------------------------------------------------------
  /**
   * @param {{x:number, z:number, yaw:number, track?:()=>number, warn:number, lockBefore?:number}} o
   */
  line({ x, z, yaw, track = null, warn = BOSS.lightning.warn, lockBefore = BOSS.lightning.lockBefore, length = BOSS.lightning.length, width = BOSS.lightning.width, beam = BOSS.lightning.beam }) {
    const g = this.game;
    const root = new THREE.Group();
    root.position.set(x, 0.045, z);
    const fillMat = addMat(WARN, 0.3);
    const fill = new THREE.Mesh(this.linePlane, fillMat);
    fill.renderOrder = 5;
    const edgeMat = addMat(WARN, 0.75, edgeTexture());
    const edge = new THREE.Mesh(this.linePlane, edgeMat);
    edge.renderOrder = 6;
    edge.position.y = 0.01;
    root.add(fill, edge);
    const bg = new THREE.Group();
    bg.visible = false;
    const outer = new THREE.Mesh(this.beamGeo, addMat(BEAM, 0.55));
    const core = new THREE.Mesh(this.beamGeo, addMat(BEAM_CORE, 0.95));
    bg.add(outer, core);
    bg.position.set(x, 0.45, z);
    g.scene.add(root, bg);
    const it = {
      t: 0, state: 'warn', yaw, hit: false,
      update: (dt) => {
        it.t += dt;
        if (it.state === 'warn') {
          if (track && it.t < warn - lockBefore) it.yaw = track();
          root.rotation.y = it.yaw;
          const prog = clamp(it.t / warn, 0, 1);
          edge.scale.set(width, 1, length);
          fill.scale.set(width * smoothstep(prog), 1, length);
          edgeMat.opacity = 0.55 + 0.35 * Math.abs(Math.sin(it.t * (10 + 18 * prog)));
          fillMat.opacity = 0.1 + 0.3 * prog;
          if (it.t >= warn) {
            it.state = 'beam';
            it.t = 0;
            root.visible = false;
            bg.visible = true;
            bg.rotation.y = it.yaw;
            this._beamBurst(x, z, it.yaw, length);
          }
          return true;
        }
        // feixe
        const k = 1 - it.t / beam;
        const flick = 1 + 0.25 * Math.sin(it.t * 70);
        outer.scale.set(0.34 * width * flick * (0.6 + 0.4 * k), 0.34 * width * flick * (0.6 + 0.4 * k), length);
        core.scale.set(0.12 * width * flick, 0.12 * width * flick, length);
        outer.material.opacity = 0.5 * Math.min(1, k * 3);
        core.material.opacity = 0.9 * Math.min(1, k * 3);
        if (!it.hit) this._beamDamage(it, x, z, length, width);
        return it.t < beam;
      },
      dispose: () => { g.scene.remove(root, bg); fillMat.dispose(); edgeMat.dispose(); outer.material.dispose(); core.material.dispose(); },
    };
    return this._add(it);
  }

  _beamBurst(x, z, yaw, length) {
    const g = this.game;
    for (let i = 0; i < 26; i++) {
      const d = (i / 25) * length;
      const c = PURPLE_PALETTE[(Math.random() * PURPLE_PALETTE.length) | 0];
      g.sparkles.emit({ x: x + Math.sin(yaw) * d + rand(-0.3, 0.3), y: rand(0.15, 0.75), z: z + Math.cos(yaw) * d + rand(-0.3, 0.3), vx: rand(-0.4, 0.4), vy: rand(0.2, 0.9), vz: rand(-0.4, 0.4), life: rand(0.35, 0.8), size: rand(0.06, 0.11), r: c[0], g: c[1], b: c[2], gravity: -0.3, drag: 1.5 });
    }
  }

  _beamDamage(it, x, z, length, width) {
    const p = this.player;
    if (p.defeated) return;
    const dx = Math.sin(it.yaw), dz = Math.cos(it.yaw);
    const t = clamp((p.pos.x - x) * dx + (p.pos.z - z) * dz, 0, length);
    const d = Math.hypot(p.pos.x - (x + dx * t), p.pos.z - (z + dz * t));
    if (d > width / 2 + 0.16) return;
    this.vitals.hit(BOSS.lightning.damage, x, z);
    const k = this._result();
    if (k === 'hurt' || k === 'blocked') it.hit = true;
  }

  // -----------------------------------------------------------------------------------------------
  // Círculos: raízes (dano) e sigilos (invocação)
  // -----------------------------------------------------------------------------------------------
  /**
   * @param {{x:number, z:number, radius?:number, warn:number, kind?:'roots'|'sigil', onFire?:()=>void, delay?:number}} o
   */
  circle({ x, z, radius = BOSS.roots.radius, warn, kind = 'roots', onFire = null, delay = 0 }) {
    const g = this.game;
    const color = kind === 'sigil' ? WARN_SIGIL : kind === 'thorn' ? WARN_THORN : WARN_ROOTS;
    const root = new THREE.Group();
    root.position.set(x, 0.05, z);
    root.visible = false;
    const ringMat = addMat(color, 0.9);
    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.scale.set(radius, 1, radius);
    ring.renderOrder = 6;
    const fillMat = addMat(color, 0.3);
    const fill = new THREE.Mesh(this.discGeo, fillMat);
    fill.renderOrder = 5;
    fill.position.y = -0.005;
    root.add(ring, fill);
    if (kind === 'sigil') {                       // estrelinha de 5 pontas dentro do sigilo
      const pts = [];
      for (let i = 0; i < 5; i++) { const a = (i * 2 * Math.PI * 2) / 5 + Math.PI / 2; pts.push(new THREE.Vector3(Math.cos(a), 0.01, Math.sin(a))); }
      pts.push(pts[0]);
      const star = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, toneMapped: false, depthWrite: false }));
      star.scale.set(radius * 0.88, 1, radius * 0.88);
      root.add(star);
      root.userData.star = star;
    }
    g.scene.add(root);

    let spikes = null;
    const it = {
      t: -delay, state: 'warn', hit: false,
      update: (dt) => {
        it.t += dt;
        if (it.t < 0) return true;
        root.visible = true;
        if (it.state === 'warn') {
          const prog = clamp(it.t / warn, 0, 1);
          fill.scale.set(radius * smoothstep(prog), 1, radius * smoothstep(prog));
          fillMat.opacity = 0.18 + 0.4 * prog;
          ringMat.opacity = 0.55 + 0.4 * Math.abs(Math.sin(it.t * (9 + 16 * prog)));
          ring.rotation.y = it.t * 0.8;
          if (root.userData.star) root.userData.star.rotation.y = -it.t * 1.6;
          if (it.t >= warn) {
            it.state = 'fire';
            it.t = 0;
            onFire?.();
            if (kind === 'roots') spikes = this._erupt(root, x, z, radius);
          }
          return true;
        }
        if (kind === 'thorn') return this._thornFall(it, root, x, z, radius, ringMat, fillMat);
        if (kind === 'sigil') {                    // some depressa
          const k = clamp(it.t / 0.45, 0, 1);
          ringMat.opacity = 0.9 * (1 - k); fillMat.opacity = 0.5 * (1 - k);
          g.sparkles.burst(x, 0.1, z, 1, { speed: 0.8, life: 0.7, size: 0.07, gravity: 0.6, palette: PURPLE_PALETTE });
          return k < 1;
        }
        // raízes: sobem, ficam e voltam para o chão
        const B = BOSS.roots;
        const up = smoothstep(it.t / 0.14), down = smoothstep((it.t - B.hold) / 0.3);
        const h = easeOutBack(Math.min(1, it.t / 0.16), 2.0) * (1 - down);
        for (const s of spikes) s.mesh.scale.set(1, Math.max(0.001, s.h * h), 1);
        ringMat.opacity = 0.9 * (1 - down); fillMat.opacity = 0.35 * (1 - down);
        if (!it.hit && it.t < 0.2) this._rootsDamage(it, x, z, radius);
        void up;
        return it.t < B.hold + 0.3;
      },
      dispose: () => { g.scene.remove(root); ringMat.dispose(); fillMat.dispose(); },
    };
    return this._add(it);
  }

  /** A big dark crystal thorn drops onto the warned spot (from above: the shield can't stop it). */
  _thornFall(it, root, x, z, radius, ringMat, fillMat) {
    const g = this.game, T = BOSS.thorns;
    if (!it.thorn) {
      const m = new THREE.Mesh(this.coneGeo, this.rootMat);
      m.rotation.x = Math.PI;                      // point down
      m.scale.set(2.6, 0.75, 2.6);
      m.castShadow = true;
      const tip = new THREE.Mesh(this.sphereGeo, this.tipMat);
      tip.scale.setScalar(0.035);
      tip.position.y = 1.0;
      m.add(tip);
      m.position.set(0, T.dropFrom, 0);
      root.add(m);
      it.thorn = m;
    }
    const fall = clamp(it.t / T.fallTime, 0, 1);
    it.thorn.position.y = T.dropFrom * (1 - fall * fall) + 0.72 * fall * fall;
    if (fall >= 1 && !it.landed) {
      it.landed = true;
      g.sparkles.burst(x, 0.12, z, 18, { speed: 2.2 * radius, life: 0.55, size: 0.08, gravity: -5, palette: DIRT });
      g.sparkles.burst(x, 0.4, z, 10, { speed: 1.1, life: 0.6, size: 0.07, gravity: -0.4, palette: PURPLE_PALETTE });
      const p = this.player;
      if (!p.defeated && Math.hypot(p.pos.x - x, p.pos.z - z) <= radius + 0.05) {
        this.vitals.hit(T.damage, x, z, { unblockable: true });
        this._result();
      }
    }
    const out = clamp((it.t - T.fallTime - T.linger) / 0.3, 0, 1);
    if (it.landed) it.thorn.scale.set(2.6 * (1 - out) + 0.001, 0.75 * (1 - out) + 0.001, 2.6 * (1 - out) + 0.001);
    ringMat.opacity = 0.9 * (1 - fall); fillMat.opacity = 0.4 * (1 - fall);
    return out < 1;
  }

  // -----------------------------------------------------------------------------------------------
  // Onda de Escuridão: an expanding ring (dodge through it with the roll's invincibility, or block it)
  // -----------------------------------------------------------------------------------------------
  wave({ x, z }) {
    const g = this.game, W = BOSS.wave;
    const mat = addMat(WAVE, 0.85);
    const ring = new THREE.Mesh(this.ringGeo, mat);
    ring.position.set(x, 0.12, z);
    ring.renderOrder = 6;
    g.scene.add(ring);
    g.puffs?.puff(x, 0.1, z, { colors: ['#3b2057', '#52307a'], count: 7, scale: 1.3, life: 0.5 });
    const it = {
      t: 0, hit: false,
      update: (dt) => {
        it.t += dt;
        const r = 0.4 + W.speed * it.t;
        ring.scale.set(r, 1, r);
        mat.opacity = 0.85 * (1 - clamp((r - W.maxR * 0.75) / (W.maxR * 0.25), 0, 1));
        const c = PURPLE_PALETTE[(Math.random() * PURPLE_PALETTE.length) | 0];
        const a = Math.random() * Math.PI * 2;
        g.sparkles.emit({ x: x + Math.sin(a) * r, y: 0.15, z: z + Math.cos(a) * r, vx: 0, vy: rand(0.3, 0.8), vz: 0, life: 0.4, size: 0.08, r: c[0], g: c[1], b: c[2], gravity: -0.2, drag: 1 });
        const p = this.player;
        if (!it.hit && !p.defeated) {
          const d = Math.hypot(p.pos.x - x, p.pos.z - z);
          if (Math.abs(d - r) < W.width) {
            this.vitals.hit(W.damage, x, z);
            const k = this._result();
            if (k === 'hurt' || k === 'blocked' || k === 'dodged' || k === 'invuln') it.hit = true;
          }
        }
        return r < W.maxR;
      },
      dispose: () => { g.scene.remove(ring); mat.dispose(); },
    };
    return this._add(it);
  }

  // -----------------------------------------------------------------------------------------------
  // Coelho-Bomba: the hat bunny hops after her and goes 'poof' (one magic bolt defuses it)
  // -----------------------------------------------------------------------------------------------
  bunny({ x, y, z, enemies = null }) {
    const g = this.game, B = BOSS.bunny;
    const root = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: '#f4f1ec', roughness: 0.8 });
    const pink = new THREE.MeshStandardMaterial({ color: '#f3a7b3', roughness: 0.7 });
    const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 0.6, 2.4), toneMapped: false });
    const body = new THREE.Mesh(this.sphereGeo, white);
    body.scale.set(0.12, 0.1, 0.11);
    body.position.y = 0.1;
    root.add(body);
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(this.sphereGeo, white);
      ear.scale.set(0.03, 0.08, 0.022);
      ear.position.set(sx * 0.045, 0.24, 0.0);
      ear.rotation.z = -sx * 0.25;
      const inner = new THREE.Mesh(this.sphereGeo, pink);
      inner.scale.set(0.5, 0.75, 0.4);
      inner.position.z = 0.6;
      ear.add(inner);
      root.add(ear);
      const eye = new THREE.Mesh(this.sphereGeo, glowMat);
      eye.scale.setScalar(0.016);
      eye.position.set(sx * 0.04, 0.13, 0.095);
      root.add(eye);
    }
    root.position.set(x, 0, z);
    root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.scene.add(root);
    g.sparkles.burst(x, y, z, 10, { speed: 1.2, life: 0.5, size: 0.06, gravity: -1, palette: PURPLE_PALETTE });
    let warnRing = null;
    const it = {
      t: 0, hopT: 0, state: 'hop', dead: false, from: { x, z }, to: { x, z },
      pos: root.position, radius: 0.16, targetable: true,
      accepts: () => true,
      damage: () => { if (it.state === 'hop') { it.state = 'defused'; it.t = 0; } return true; },
      update: (dt) => {
        it.t += dt;
        const p = this.player;
        if (it.state === 'defused') {        // bolt hit: harmless poof of confetti
          g.sparkles.burst(root.position.x, 0.2, root.position.z, 20, { speed: 1.8, life: 0.6, size: 0.06, gravity: -2, palette: [[2.4, 2.4, 2.4], [2.4, 1.4, 1.8]] });
          g.puffs?.puff(root.position.x, 0.15, root.position.z, { colors: ['#f4f1ec', '#f3a7b3'], count: 5, scale: 0.7, life: 0.45 });
          return false;
        }
        if (it.state === 'hop') {
          it.hopT += dt;
          const k = clamp(it.hopT / B.hop, 0, 1);
          root.position.x = it.from.x + (it.to.x - it.from.x) * k;
          root.position.z = it.from.z + (it.to.z - it.from.z) * k;
          root.position.y = 0.32 * Math.sin(Math.PI * k);
          root.rotation.y = Math.atan2(it.to.x - it.from.x, it.to.z - it.from.z);
          if (k >= 1) {                       // next hop toward her
            it.hopT = 0;
            it.from = { x: root.position.x, z: root.position.z };
            const dx = p.pos.x - it.from.x, dz = p.pos.z - it.from.z, d = Math.hypot(dx, dz) || 1;
            const step = Math.min(d, B.step);
            it.to = { x: it.from.x + (dx / d) * step, z: it.from.z + (dz / d) * step };
            if (d < B.trigger || it.t > B.life) { it.state = 'fuse'; it.t = 0; }
          }
          return true;
        }
        if (it.state === 'fuse') {            // shakes, glows, warning circle -> boom
          if (!warnRing) {
            warnRing = new THREE.Mesh(this.discGeo, addMat(WARN_ROOTS, 0.35));
            warnRing.scale.set(B.radius, 1, B.radius);
            warnRing.position.set(root.position.x, 0.05, root.position.z);
            g.scene.add(warnRing);
          }
          root.position.y = 0.02 * Math.abs(Math.sin(it.t * 40));
          body.scale.setScalar(0.11 * (1 + 0.6 * it.t / B.fuse));
          warnRing.material.opacity = 0.2 + 0.4 * Math.abs(Math.sin(it.t * 18));
          if (it.t >= B.fuse) {
            const bx = root.position.x, bz = root.position.z;
            g.sparkles.burst(bx, 0.25, bz, 30, { speed: 2.6, life: 0.7, size: 0.08, gravity: -1.5, palette: PURPLE_PALETTE });
            g.puffs?.puff(bx, 0.2, bz, { colors: ['#3b2057', '#52307a', '#f4f1ec'], count: 9, scale: 1.4, life: 0.6 });
            if (!p.defeated && Math.hypot(p.pos.x - bx, p.pos.z - bz) <= B.radius) { this.vitals.hit(B.damage, bx, bz); this._result(); }
            return false;
          }
          return true;
        }
        return false;
      },
      dispose: () => {
        g.scene.remove(root);
        if (warnRing) { g.scene.remove(warnRing); warnRing.material.dispose(); }
        white.dispose(); pink.dispose(); glowMat.dispose();
        it.targetable = false;
        if (enemies) enemies.extras = enemies.extras.filter((e) => e !== it);
      },
    };
    if (enemies) enemies.extras.push(it);
    return this._add(it);
  }

  _erupt(root, x, z, radius) {
    const g = this.game;
    const spikes = [];
    const n = Math.round(9 * radius);
    for (let i = 0; i <= n; i++) {
      const center = i === 0;
      const a = rand(0, Math.PI * 2), r = center ? 0 : radius * Math.sqrt(rand(0.15, 0.95));
      const mesh = new THREE.Mesh(this.coneGeo, this.rootMat);
      mesh.castShadow = true;
      const w = center ? 2.2 : rand(0.8, 1.5);
      const hgt = center ? 1.35 : rand(0.6, 1.1);
      mesh.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      mesh.rotation.set(rand(-0.25, 0.25), rand(0, 6), rand(-0.25, 0.25));
      mesh.scale.set(w, 0.001, w);
      root.add(mesh);
      spikes.push({ mesh, h: hgt });
      const tip = new THREE.Mesh(this.sphereGeo, this.tipMat);
      tip.scale.setScalar(0.025);
      tip.position.set(0, 1.0, 0);
      mesh.add(tip);
    }
    g.sparkles.burst(x, 0.15, z, 26, { speed: 2.4 * radius, life: 0.7, size: 0.08, gravity: -5, palette: DIRT });
    g.sparkles.burst(x, 0.3, z, 14, { speed: 1.2, life: 0.8, size: 0.07, gravity: -0.4, palette: PURPLE_PALETTE });
    g.puffs?.puff(x, 0.05, z, { colors: ['#3b2057', '#52307a'], count: 6, scale: 1.1, life: 0.55 });
    return spikes;
  }

  _rootsDamage(it, x, z, radius) {
    const p = this.player;
    if (p.defeated) return;
    if (Math.hypot(p.pos.x - x, p.pos.z - z) > radius + 0.05) return;
    this.vitals.hit(BOSS.roots.damage, x, z, { unblockable: true });      // vêm do chão: o escudo não segura
    const k = this._result();
    if (k === 'hurt') it.hit = true;
  }
}

function ROOT_TIP() { return new THREE.Color(2.2, 0.8, 3.0); }
const WARN_THORN = new THREE.Color(2.4, 0.45, 1.1);
const WAVE = new THREE.Color(1.3, 0.45, 2.4);
