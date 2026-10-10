import * as THREE from 'three';
import { CAMERA } from './config.js';
import { Occlusion } from './Occlusion.js';
import { angleDiff, clamp, damp, dampAngle, easeInOutCubic, lerp } from './util.js';

const DEG = Math.PI / 180;
const _s1 = new THREE.Vector3();
const _s2 = new THREE.Vector3();
const _s3 = new THREE.Vector3();
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * Câmera 3/4 de cima que segue a Aprendiz.
 *  - roda do mouse: zoom contínuo u (-0.3 .. 1) do enquadramento "tático" (u = 0) ao "retrato" (u = 1), com curva suave;
 *  - botão do meio arrastando (ou Z/X): gira (yaw) e inclina (pitch); dentro de casa o yaw é limitado;
 *  - C: alterna o close;
 *  - setShot(): tomadas de câmera de cutscene (Promise); setSceneMode(): casa x ar livre;
 *  - setOccluders(): paredes que somem quando tapam a visão.
 */
export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.fov = CAMERA.fov;
    this.baseYaw = THREE.MathUtils.degToRad(CAMERA.yawDeg);
    this.orbitYaw = 0;        // deslocamentos pedidos pelo jogador (rad)
    this.orbitPitch = 0;
    this._yaw = this.baseYaw; // valores suavizados que realmente posicionam a câmera
    this._orbitYawS = 0;
    this._orbitPitchS = 0;
    this.zoom = 0;            // u suavizado
    this.zoomTarget = 0;
    this._zoomBeforeClose = 0;
    this.focus = new THREE.Vector3();
    this.bounds = null;
    this.extra = null;        // () => Vector3|null : ponto de interesse que "puxa" o foco (cutscenes)
    this.extraWeight = 0;
    this.aspect = 16 / 9;
    this.aspectBoost = 1;
    this.indoor = true;
    this.yawLimit = CAMERA.indoorYawLimitDeg * DEG;
    this.shot = null;         // {kind, resolve, t, ...}
    this.resolveActor = null; // (spec) => {pos, yaw, kind} | null   (o Game liga)
    this.occlusion = new Occlusion();
    this._target = new THREE.Vector3();
    this._dist = CAMERA.distance;
    this._pitch = THREE.MathUtils.degToRad(CAMERA.pitchDeg);
    this._aim = CAMERA.aimHeight;
    camera.fov = this.fov;
    camera.near = 0.1;
    camera.far = 80;
  }

  // ----- configuração ---------------------------------------------------------------------------
  setBounds(b) { this.bounds = b; }

  /** Casa (yaw limitado) ou ar livre (órbita livre). */
  setSceneMode({ indoor = true, yawLimitDeg = CAMERA.indoorYawLimitDeg } = {}) {
    this.indoor = !!indoor;
    this.yawLimit = yawLimitDeg * DEG;
    this.camera.far = this.indoor ? 80 : 150;
    this.camera.updateProjectionMatrix();
    if (this.indoor) this.orbitYaw = clamp(this.orbitYaw, -this.yawLimit, this.yawLimit);
  }

  /** Paredes que somem quando ficam entre a câmera e a Aprendiz (agrupadas por userData.wall). */
  setOccluders(list = []) {
    this.occlusion.setOccluders(list ?? []);
  }

  setAspect(aspect) {
    this.aspect = aspect;
    this.camera.aspect = aspect;
    // telas estreitas/altas: afasta um pouco para a cena continuar visível
    this.aspectBoost = clamp(1.25 / aspect, 1, 1.7);
    this.camera.updateProjectionMatrix();
  }

  /** Yaw efetivo da câmera (rad). Os controles são relativos a ele. */
  get yaw() { return this._yaw; }

  /** Vetores de movimento relativos à câmera (projetados no plano XZ). */
  basis(forward = new THREE.Vector3(), right = new THREE.Vector3()) {
    const y = this._yaw;
    forward.set(-Math.sin(y), 0, -Math.cos(y));
    right.set(Math.cos(y), 0, -Math.sin(y));
    return { forward, right };
  }

  // ----- entradas -------------------------------------------------------------------------------
  addZoom(wheel) {
    if (this.shot) return;
    // roda para trás (+) afasta, para frente (-) aproxima
    this.zoomTarget = clamp(this.zoomTarget - wheel * CAMERA.zoomStep, -CAMERA.zoomOutRange, 1);
  }

  /** Tecla C: alterna o close de rosto. */
  toggleCloseup() {
    if (this.shot) return;
    if (this.zoomTarget < 0.85) { this._zoomBeforeClose = this.zoomTarget; this.zoomTarget = 1; }
    else this.zoomTarget = Math.min(0.5, this._zoomBeforeClose);
  }

  /** Arrasto com o botão do meio (pixels). */
  addOrbit(dx, dy) {
    if (this.shot || (!dx && !dy)) return;
    this.orbitYaw -= dx * CAMERA.orbitYawSpeed;
    this.orbitPitch += dy * CAMERA.orbitPitchSpeed;
    if (this.indoor) this.orbitYaw = clamp(this.orbitYaw, -this.yawLimit, this.yawLimit);
    else this.orbitYaw = wrap(this.orbitYaw);
    this.orbitPitch = clamp(this.orbitPitch, -35 * DEG, 30 * DEG);
  }

  // ----- tomadas de câmera ----------------------------------------------------------------------
  _actor(spec) {
    if (!spec) return null;
    if (spec.isObject3D) {
      const p = spec.getWorldPosition(new THREE.Vector3());
      return { pos: p, yaw: spec.rotation.y, kind: 'apprentice' };
    }
    if (spec.pos && typeof spec.yaw === 'number') return { pos: spec.pos, yaw: spec.yaw, kind: spec.kind ?? (spec.name === 'Yumi' || spec.name === 'Petico' ? 'cat' : 'apprentice'), live: spec };
    if (typeof spec.x === 'number' && typeof spec.z === 'number') return { pos: new THREE.Vector3(spec.x, spec.y ?? 0, spec.z), yaw: 0, kind: 'apprentice' };
    return this.resolveActor?.(spec) ?? null;
  }

  /**
   * Tomada de câmera. Presets: 'default' | 'closeup' {target, other?} | 'twoShot' {a, b}.
   * Retorna uma Promise resolvida quando a câmera assenta (ou após `CAMERA.shot.timeout`).
   */
  setShot(preset = 'default', opts = {}) {
    if (this.shot) { this.shot.resolve(); }
    if (preset === 'default' || !preset) {
      return new Promise((resolve) => {
        this.shot = { kind: 'default', resolve, t: 0, ending: true };
      });
    }
    return new Promise((resolve) => {
      this.shot = { kind: preset, opts, resolve, t: 0, ending: false };
    });
  }

  _settleShot() {
    const s = this.shot;
    if (!s) return;
    this.shot = null;
    s.resolve();
  }

  /** Parâmetros desejados da tomada ativa: {focus, dist, pitch, aim, yaw}. */
  _shotGoal(s) {
    const C = CAMERA.shot;
    if (s.kind === 'closeup') {
      const a = this._actor(s.opts.target ?? this.resolveActor?.('Aprendiz'));
      if (!a) return null;
      const cfg = a.kind === 'cat' ? C.closeupCat : C.closeupApprentice;
      const other = this._actor(s.opts.other);
      let yaw;
      if (other) {
        // câmera de lado (do lado da câmera padrão), girada um pouco para o rosto de quem fala
        const dx = other.pos.x - a.pos.x, dz = other.pos.z - a.pos.z;
        const l = Math.hypot(dx, dz) || 1;
        let nx = -dz / l, nz = dx / l;
        if (nz < 0) { nx = -nx; nz = -nz; }
        const base = Math.atan2(nx, nz);
        const sign = Math.sign((dx / l) * Math.cos(base) - (dz / l) * Math.sin(base)) || 1;
        yaw = base + sign * cfg.yawOffsetDeg * DEG;
      } else {
        yaw = a.yaw + cfg.yawOffsetDeg * DEG;
      }
      return { focus: _s1.set(a.pos.x, 0, a.pos.z), dist: cfg.distance, pitch: cfg.pitchDeg * DEG, aim: cfg.aimHeight, yaw };
    }
    if (s.kind === 'twoShot') {
      const a = this._actor(s.opts.a);
      const b = this._actor(s.opts.b);
      if (!a || !b) return null;
      const cfg = C.twoShot;
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
      const span = Math.hypot(dx, dz);
      let nx = -dz / (span || 1), nz = dx / (span || 1);
      if (nz < 0) { nx = -nx; nz = -nz; }
      const yaw = Math.atan2(nx, nz) + cfg.yawOffsetDeg * DEG * (nx >= 0 ? -1 : 1) * 0.6;
      const tanH = Math.tan(this.fov * DEG / 2) * Math.max(0.6, this.aspect);
      const dist = Math.max(cfg.minDistance, (span / 2 + cfg.margin) / tanH);
      return { focus: _s1.set((a.pos.x + b.pos.x) / 2, 0, (a.pos.z + b.pos.z) / 2), dist, pitch: cfg.pitchDeg * DEG, aim: cfg.aimHeight, yaw };
    }
    return null;
  }

  // ----- foco ----------------------------------------------------------------------------------
  _clampFocus(v) {
    const b = this.bounds;
    if (!b) return v;
    const mx = Math.min(this.indoor ? 1.2 : 0.5, (b.maxX - b.minX) / 2);
    const mz = Math.min(this.indoor ? 0.8 : 0.5, (b.maxZ - b.minZ) / 2);
    v.x = clamp(v.x, b.minX + mx, b.maxX - mx);
    v.z = clamp(v.z, b.minZ + mz, b.maxZ - mz);
    return v;
  }

  /** Posição ideal do foco para um alvo (com olhada à frente e pontos de interesse). */
  _desired(target, velocity, out, k = 0, aim = CAMERA.aimHeight) {
    out.set(target.x, aim, target.z);
    if (velocity) {
      const la = CAMERA.lookAhead * (1 - k);
      out.x += velocity.x * la; out.z += velocity.z * la;
    }
    if (this.extra && this.extraWeight > 0.001) {
      const p = this.extra();
      if (p) {
        out.x += (p.x - out.x) * this.extraWeight * 0.45;
        out.z += (p.z - out.z) * this.extraWeight * 0.45;
      }
    }
    return this._clampFocus(out);
  }

  snapTo(target) {
    this._target.set(target.x, target.y ?? 0, target.z);
    this.shot = null;
    this.zoom = this.zoomTarget;
    this._orbitYawS = this.orbitYaw;
    this._orbitPitchS = this.orbitPitch;
    this._applyParams(0, true);
    this._desired(target, null, this.focus, this._k(), this._aim);
    this._yaw = this.baseYaw + this._orbitYawS;
    this._place();
  }

  _k() { return easeInOutCubic(clamp(this.zoom, 0, 1)); }

  /** Distância / pitch / altura de mira do enquadramento dado pelo zoom (e a órbita). */
  _applyParams(dt, snap = false) {
    const k = this._k();
    const u = this.zoom;
    const P = CAMERA.portrait;
    let dist = lerp(CAMERA.distance, P.distance, k);
    if (u < 0) dist = CAMERA.distance * lerp(1, CAMERA.zoomOutMax, clamp(-u / CAMERA.zoomOutRange, 0, 1));
    const pitchMin = (this.indoor ? CAMERA.pitchMinIndoorDeg : CAMERA.pitchMinDeg) * DEG;
    const pitch = clamp(lerp(CAMERA.pitchDeg, P.pitchDeg, k) * DEG + this._orbitPitchS, pitchMin, CAMERA.pitchMaxDeg * DEG);
    const aim = lerp(CAMERA.aimHeight, P.aimHeight, k);
    if (snap) { this._dist = dist; this._pitch = pitch; this._aim = aim; } else { this._wantDist = dist; this._wantPitch = pitch; this._wantAim = aim; }
  }

  update(dt, target, velocity) {
    this._target.set(target.x, target.y ?? 0, target.z);
    // zoom + órbita (valores suavizados)
    this.zoom = damp(this.zoom, this.zoomTarget, CAMERA.zoomLambda, dt);
    this._orbitYawS = damp(this._orbitYawS, this.orbitYaw, CAMERA.orbitLambda, dt);
    this._orbitPitchS = damp(this._orbitPitchS, this.orbitPitch, CAMERA.orbitLambda, dt);
    this.extraWeight = damp(this.extraWeight, this.extra ? 1 : 0, 3, dt);

    const k = this._k();
    this._applyParams(dt);
    let wantYaw = this.baseYaw + this._orbitYawS;
    let wantFocus = this._desired(target, velocity, _s2, k, this._wantAim);
    let dist = this._wantDist, pitch = this._wantPitch, aim = this._wantAim;
    // fight framing: back the camera off as the point of interest (the boss) gets farther, so both stay in view
    if (this.extra && this.extraWeight > 0.001 && !this.shot) {
      const p = this.extra();
      if (p) {
        const sep = Math.hypot(p.x - target.x, p.z - target.z);
        dist = Math.max(dist, lerp(dist, Math.min(11, 2.4 + sep * 0.85), this.extraWeight));
      }
    }
    let lam = lerp(CAMERA.damping, CAMERA.dampingPortrait, k);

    const s = this.shot;
    if (s) {
      s.t += dt;
      const goal = s.kind === 'default' ? null : this._shotGoal(s);
      if (goal) {
        wantFocus = _s3.copy(goal.focus);
        wantFocus.y = goal.aim;
        this._clampFocus(wantFocus);
        dist = goal.dist; pitch = goal.pitch; aim = goal.aim;
        wantYaw = this.indoor ? clamp(wrap(goal.yaw), -this.yawLimit, this.yawLimit) : goal.yaw;
        lam = CAMERA.shot.lambda;
      } else if (s.kind !== 'default') {
        this._settleShot();
      } else {
        lam = CAMERA.shot.lambda;
      }
    }

    this.focus.x = damp(this.focus.x, wantFocus.x, lam, dt);
    this.focus.y = damp(this.focus.y, wantFocus.y, lam, dt);
    this.focus.z = damp(this.focus.z, wantFocus.z, lam, dt);
    const lamP = this.shot ? CAMERA.shot.lambda : CAMERA.orbitLambda * 0.5;
    this._dist = damp(this._dist, dist, this.shot ? lamP : 10, dt);
    this._pitch = damp(this._pitch, pitch, this.shot ? lamP : 10, dt);
    this._aim = damp(this._aim, aim, 10, dt);
    this._yaw = dampAngle(this._yaw, wantYaw, this.shot ? CAMERA.shot.lambda : 16, dt);

    if (this.shot) {
      const e = Math.abs(this._dist - dist) + Math.abs(angleDiff(this._yaw, wantYaw)) * 0.8 + Math.hypot(this.focus.x - wantFocus.x, this.focus.z - wantFocus.z);
      if (e < 0.06 || this.shot.t > CAMERA.shot.timeout) {
        if (this.shot.kind === 'default') this._settleShot();
        else if (!this.shot.settled) { this.shot.settled = true; this.shot.resolve(); }
      }
    }

    this._place();
    this._updateOcclusion(dt);
  }

  _place() {
    const d = this._dist * this.aspectBoost;
    const cp = Math.cos(this._pitch), sp = Math.sin(this._pitch);
    const y = this._yaw;
    // retrato: a Aprendiz fica um pouquinho de lado (deixa espaço para o balão de fala)
    const side = CAMERA.portrait.sideOffset * this._k();
    const fx = this.focus.x + Math.cos(y) * side;
    const fz = this.focus.z - Math.sin(y) * side;
    this.camera.position.set(fx + Math.sin(y) * cp * d, this.focus.y + sp * d, fz + Math.cos(y) * cp * d);
    this.camera.lookAt(fx, this.focus.y, fz);
  }

  _updateOcclusion(dt) {
    const occ = this.occlusion;
    if (!occ.units.length) return;
    const t = this._target;
    const S = this._samples ??= [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    S[0].set(t.x, 0.08, t.z); S[1].set(t.x, 0.45, t.z); S[2].set(t.x, 0.82, t.z);
    occ.update(dt, this.camera.position, S);
  }
}
