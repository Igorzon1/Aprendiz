import * as THREE from 'three';
import { Emitter, pick } from './util.js';
import { SPARK_PALETTE } from './Particles.js';
import { AIM } from './configCombat.js';

const BOLT_SPEED = 6;       // m/s
const BOLT_RANGE = 4;       // m
const BOLT_RADIUS = 0.07;   // tamanho da esfera para colisão
const AIM_CONE = 0.6;       // rad (~35°) de "ajuda de mira" em direção ao boneco
const AIM_RANGE = 4.8;

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Ataque básico: bolinha de luz saindo da ponta da varinha, trilha de estrelinhas, boneco de treino. */
export class Combat extends Emitter {
  constructor({ scene, world, collision, sparkles, texts }) {
    super();
    this.scene = scene;
    this.world = world;
    this.collision = collision;
    this.sparkles = sparkles;
    this.texts = texts;
    this.bolts = [];
    this.enemies = null;     // Enemies (v0.2): os raios testam os inimigos antes do boneco de treino

    this.coreGeo = new THREE.SphereGeometry(0.045, 12, 8);
    this.coreMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.7, 1.6), toneMapped: false });
    this.glowMat = new THREE.SpriteMaterial({
      map: glowTexture(), color: new THREE.Color(2.2, 1.4, 1.9), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });

    // uma luz única, sempre presente (evita recompilar shaders ao mudar o número de luzes)
    this.light = new THREE.PointLight('#ffd9a0', 0, 2.8, 2);
    scene.add(this.light);
    this.hits = 0;
  }

  setEnemies(enemies) { this.enemies = enemies ?? null; }

  /**
   * Dispara uma bolinha.
   * @param {THREE.Vector3} origin  ponta da varinha
   * @param {THREE.Vector3} dir     direção (vai ser normalizada)
   * @param {{mouse?:boolean}} [opts]  mouse: cone de mira mais estreito (a Aprendiz já olha para o ponteiro)
   */
  fire(origin, dir, { mouse = false } = {}) {
    const d = dir.clone().normalize();
    // mira assistida em Sombritos: o mais "na frente" dentro do cone
    let assisted = false;
    if (this.enemies) {
      const cone = mouse ? AIM.coneMouse : AIM.coneKey;
      const df = new THREE.Vector3(d.x, 0, d.z).normalize();
      let best = null, bestAng = cone;
      for (const e of this.enemies.list) {
        if (!e.targetable) continue;
        const dx = e.pos.x - origin.x, dz = e.pos.z - origin.z;
        const dist = Math.hypot(dx, dz);
        if (dist > AIM.enemyRange || dist < 0.05) continue;
        const ang = Math.acos(THREE.MathUtils.clamp((dx * df.x + dz * df.z) / dist, -1, 1));
        if (ang < bestAng) { bestAng = ang; best = e; }
      }
      if (best) {
        const c = best.centerWorld(new THREE.Vector3()).sub(origin);
        const hd = Math.hypot(c.x, c.z) || 1;
        c.y = THREE.MathUtils.clamp(c.y, -AIM.maxDy, AIM.maxDy) * Math.min(1, hd / 1.2);
        d.copy(c).normalize();
        assisted = true;
      }
    }
    // ajuda de mira: puxa a direção para o boneco se ele estiver na frente e perto
    const dummy = this.world?.dummy;
    if (dummy && !assisted) {
      const to = dummy.center.clone().sub(origin);
      const dist = Math.hypot(to.x, to.z);
      if (dist < AIM_RANGE) {
        const flat = new THREE.Vector3(to.x, 0, to.z).normalize();
        const df = new THREE.Vector3(d.x, 0, d.z).normalize();
        if (Math.acos(THREE.MathUtils.clamp(flat.dot(df), -1, 1)) < AIM_CONE) {
          to.y = THREE.MathUtils.clamp(to.y, -0.25, 0.25) + 0; // mira no tronco, sem ficar íngreme
          d.copy(to).normalize();
        }
      }
    }

    const group = new THREE.Group();
    group.add(new THREE.Mesh(this.coreGeo, this.coreMat));
    const glow = new THREE.Sprite(this.glowMat);
    glow.scale.setScalar(0.34);
    group.add(glow);
    group.position.copy(origin);
    this.scene.add(group);

    const bolt = { group, glow, dir: d, travelled: 0, trailT: 0, age: 0, origin: origin.clone() };
    this.bolts.push(bolt);
    // uma faísquinha na saída
    this.sparkles.burst(origin.x, origin.y, origin.z, 7, { speed: 0.9, life: 0.4, size: 0.05, gravity: 0 });
    return bolt;
  }

  _kill(bolt, burst = true) {
    const p = bolt.group.position;
    if (burst) this.sparkles.burst(p.x, p.y, p.z, 9, { speed: 1.1, life: 0.5, size: 0.055, gravity: -0.8 });
    this.scene.remove(bolt.group);
    bolt.dead = true;
  }

  update(dt) {
    const dummy = this.world?.dummy;
    for (const b of this.bolts) {
      if (b.dead) continue;
      b.age += dt;
      const total = BOLT_SPEED * dt;
      const steps = Math.max(1, Math.ceil(total / 0.05));
      const step = total / steps;
      for (let i = 0; i < steps && !b.dead; i++) {
        b.group.position.addScaledVector(b.dir, step);
        b.travelled += step;
        const p = b.group.position;

        if (this.enemies && this.enemies.damageAt(p, BOLT_RADIUS, 1, b.origin)) {
          this._kill(b, false);
          this.emit('enemyHit', b);
          break;
        }
        if (dummy && dummy.box.distanceToPoint(p) < BOLT_RADIUS + 0.06) {
          this._hitDummy(b, dummy);
          break;
        }
        if (this.collision.pointBlocked(p.x, p.y, p.z, 0.02)) {
          // pequena nuvem de faíscas na parede
          this._kill(b);
          break;
        }
        if (b.travelled >= BOLT_RANGE) { this._kill(b); break; }
      }
      if (b.dead) continue;

      // pulsa e deixa a trilha de estrelinhas
      const pulse = 1 + Math.sin(b.age * 40) * 0.12;
      b.glow.scale.setScalar(0.34 * pulse);
      b.trailT -= dt;
      while (b.trailT <= 0) {
        b.trailT += 0.022;
        const p = b.group.position;
        const c = pick(SPARK_PALETTE);
        this.sparkles.emit({
          x: p.x + (Math.random() - 0.5) * 0.04, y: p.y + (Math.random() - 0.5) * 0.04, z: p.z + (Math.random() - 0.5) * 0.04,
          vx: (Math.random() - 0.5) * 0.35, vy: Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.35,
          life: 0.35 + Math.random() * 0.25, size: 0.04 + Math.random() * 0.04, r: c[0], g: c[1], b: c[2], gravity: -0.4, drag: 2,
        });
      }
    }
    this.bolts = this.bolts.filter((b) => !b.dead);

    // luz que acompanha a bolinha mais nova
    const last = this.bolts[this.bolts.length - 1];
    if (last) {
      this.light.position.copy(last.group.position);
      this.light.intensity = 1.8;
    } else {
      this.light.intensity = Math.max(0, this.light.intensity - dt * 14);
    }
  }

  _hitDummy(bolt, dummy) {
    const p = bolt.group.position;
    const dx = bolt.dir.x, dz = bolt.dir.z;
    const l = Math.hypot(dx, dz) || 1;
    dummy.hit(dx / l, dz / l, 5.5);
    this.hits++;
    this.sparkles.burst(p.x, p.y, p.z, 20, { speed: 2.0, life: 0.8, size: 0.075, gravity: -1.5 });
    const label = Math.random() < 0.7 ? '+1' : 'Pow!';
    this.texts.spawn(label, p.x, p.y + 0.35, p.z, { scale: label === '+1' ? 0.6 : 0.72 });
    this._kill(bolt, false);
    this.emit('dummyHit', dummy);
  }
}
