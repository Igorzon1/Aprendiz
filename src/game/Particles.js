import * as THREE from 'three';
import { easeOutBack } from './util.js';

/**
 * Faíscas em forma de estrelinha (THREE.Points com shader próprio).
 * Cores HDR (> 1) fazem o bloom brilhar. Um único draw call para todas as faíscas.
 */
const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec4 aColor;
  attribute float aRot;
  uniform float uScale;
  varying vec4 vColor;
  varying float vRot;
  void main() {
    vColor = aColor;
    vRot = aRot;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  varying vec4 vColor;
  varying float vRot;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float c = cos(vRot), s = sin(vRot);
    p = mat2(c, -s, s, c) * p;
    // estrela de 4 pontas (astroide) + brilho suave no centro
    float d = sqrt(abs(p.x)) + sqrt(abs(p.y));
    float star = 1.0 - smoothstep(0.55, 1.0, d);
    float glow = exp(-dot(p, p) * 7.0) * 0.7;
    float a = max(star, glow) * vColor.a;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor.rgb * a, a);
  }
`;

export class Sparkles {
  constructor(scene, capacity = 700) {
    this.capacity = capacity;
    this.n = 0;
    this.cursor = 0;
    this.items = Array.from({ length: capacity }, () => ({
      life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0.05, r: 1, g: 1, b: 1,
      gravity: 0, drag: 0, spin: 0, rot: 0, shrink: true,
    }));
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.color = new Float32Array(capacity * 4);
    this.rot = new Float32Array(capacity);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: { uScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    scene.add(this.points);
  }

  /** Atualiza a escala de tamanho em pixels (altura do framebuffer / (2 tan(fov/2))). */
  setViewport(heightPx, fovDeg) {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  emit(o) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.capacity;
    it.life = it.max = o.life ?? 0.6;
    it.x = o.x; it.y = o.y; it.z = o.z;
    it.vx = o.vx ?? 0; it.vy = o.vy ?? 0; it.vz = o.vz ?? 0;
    it.size = o.size ?? 0.06;
    it.r = o.r ?? 1; it.g = o.g ?? 1; it.b = o.b ?? 1;
    it.gravity = o.gravity ?? 0;
    it.drag = o.drag ?? 1.5;
    it.spin = o.spin ?? (Math.random() - 0.5) * 6;
    it.rot = Math.random() * Math.PI;
    return it;
  }

  /** Explosão de faíscas em esfera. */
  burst(x, y, z, count = 14, { speed = 1.6, life = 0.7, size = 0.07, gravity = -1.2, palette = SPARK_PALETTE } = {}) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const s = Math.sqrt(1 - u * u);
      const sp = speed * (0.4 + Math.random() * 0.7);
      const c = palette[(Math.random() * palette.length) | 0];
      this.emit({
        x, y, z,
        vx: Math.cos(a) * s * sp, vy: u * sp * 0.8 + 0.5, vz: Math.sin(a) * s * sp,
        life: life * (0.6 + Math.random() * 0.6), size: size * (0.6 + Math.random() * 0.8),
        r: c[0], g: c[1], b: c[2], gravity, drag: 2.2,
      });
    }
  }

  update(dt) {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) {
      const it = this.items[i];
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) {
        this.size[i] = 0;
        continue;
      }
      const damp = Math.exp(-it.drag * dt);
      it.vx *= damp; it.vy = it.vy * damp + it.gravity * dt; it.vz *= damp;
      it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
      it.rot += it.spin * dt;
      const k = it.life / it.max;
      // aparece rápido, some devagar
      const alpha = Math.min(1, (1 - k) * 12) * Math.min(1, k * 2.2);
      this.pos[i * 3] = it.x; this.pos[i * 3 + 1] = it.y; this.pos[i * 3 + 2] = it.z;
      this.size[i] = it.size * 1.5 * (0.35 + 0.65 * Math.min(1, k * 1.6));
      this.color[i * 4] = it.r; this.color[i * 4 + 1] = it.g; this.color[i * 4 + 2] = it.b; this.color[i * 4 + 3] = alpha;
      this.rot[i] = it.rot;
      n++;
    }
    this.n = n;
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aColor.needsUpdate = true;
    g.attributes.aRot.needsUpdate = true;
  }
}

// Paleta fofinha (HDR leve para o bloom pegar)
export const SPARK_PALETTE = [
  [2.4, 2.0, 1.2],  // dourado
  [2.4, 1.1, 1.7],  // rosa
  [1.8, 1.6, 2.6],  // lavanda
  [2.2, 2.2, 2.0],  // branco
];

/** Texto flutuante ("+1", "Pow!") como sprite com textura de canvas. */
export class FloatingTexts {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.cache = new Map();
  }

  _texture(text) {
    let t = this.cache.get(text);
    if (t) return t;
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const g = c.getContext('2d');
    g.font = '800 84px "Fredoka", "Trebuchet MS", system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = 16;
    g.strokeStyle = '#7b3f8c';
    g.strokeText(text, 128, 68);
    g.fillStyle = '#fff6d8';
    g.fillText(text, 128, 68);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    this.cache.set(text, t);
    return t;
  }

  spawn(text, x, y, z, { scale = 0.5, life = 0.9 } = {}) {
    const mat = new THREE.SpriteMaterial({ map: this._texture(text), transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
    const s = new THREE.Sprite(mat);
    s.scale.set(scale * 2, scale, 1);
    s.position.set(x, y, z);
    s.renderOrder = 20;
    this.scene.add(s);
    this.items.push({ sprite: s, mat, life, max: life, scale, vy: 0.9 });
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.life -= dt;
      if (it.life <= 0) {
        this.scene.remove(it.sprite);
        it.mat.dispose();
        this.items.splice(i, 1);
        continue;
      }
      const k = 1 - it.life / it.max;
      it.vy = Math.max(0.15, it.vy - 1.4 * dt);
      it.sprite.position.y += it.vy * dt;
      // pop de entrada (overshoot) e desvanece no fim
      const pop = (1 + (1 - k) * 0.05) * (k < 0.25 ? Math.max(0.05, easeOutBack(k / 0.25, 2.2)) : 1);
      it.sprite.scale.set(it.scale * 2 * pop, it.scale * pop, 1);
      it.mat.opacity = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1;
    }
  }
}

/** Setinha dourada que balança e aponta para algo (a dica "olhe a geladeira"). */
export class PointerMarker {
  constructor(scene) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.05, 0.35), toneMapped: false });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.2, 4), mat);
    cone.rotation.x = Math.PI; // ponta para baixo
    cone.position.y = 0.1;
    g.add(cone);
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.07), mat);
    stem.position.y = 0.3;
    g.add(stem);
    g.visible = false;
    g.renderOrder = 15;
    scene.add(g);
    this.group = g;
    this.t = 0;
    this.target = null; // () => Vector3 | null
    this.timer = 0;
    this.scale = 0;
  }

  show(getPosition, seconds = 5) {
    this.target = getPosition;
    this.timer = seconds;
    this.group.visible = true;
  }

  hide() { this.target = null; this.timer = 0; }

  update(dt) {
    this.t += dt;
    if (this.target && this.timer > 0) {
      this.timer -= dt;
      if (this.timer <= 0) this.target = null;
    }
    const want = this.target ? 1 : 0;
    this.scale += (want - this.scale) * (1 - Math.exp(-10 * dt));
    if (this.scale < 0.01 && !this.target) { this.group.visible = false; return; }
    const p = this.target?.();
    if (p) this.group.position.set(p.x, p.y + Math.sin(this.t * 4.5) * 0.07, p.z);
    this.group.rotation.y += dt * 2.5;
    this.group.scale.setScalar(Math.max(0.001, this.scale));
  }
}
