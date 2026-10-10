// Teclado + mouse. Os listeners ficam na `window` (a UI pode ter um elemento cobrindo a tela).
const MOVE_KEYS = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};
const ATTACK_KEYS = new Set(['Space', 'KeyJ']);
const PREVENT = new Set([...Object.keys(MOVE_KEYS), 'Space', 'KeyE', 'KeyJ', 'ShiftLeft', 'ShiftRight']);

export class Input {
  constructor(target = window) {
    this.enabled = false;
    this.keys = new Set();
    this.pressed = new Set(); // teclas apertadas neste quadro (borda de subida)
    this.mouseDown = false;
    this.rightDown = false;   // botão direito: órbita da câmera
    this.orbit = { x: 0, y: 0 }; // arrasto acumulado (px) com o botão direito
    this.wheel = 0;
    this.pointer = { x: 0, y: 0, inside: false }; // coordenadas normalizadas (-1..1)
    this.attackSource = 'key'; // 'key' | 'mouse': de onde veio o último pedido de ataque
    this.lastActivity = performance.now(); // para o Idle_AFK

    target.addEventListener('keydown', (e) => this._onKey(e, true));
    target.addEventListener('keyup', (e) => this._onKey(e, false));
    target.addEventListener('mousedown', (e) => this._onMouse(e, true));
    target.addEventListener('mouseup', (e) => this._onMouse(e, false));
    target.addEventListener('mousemove', (e) => this._onMove(e));
    target.addEventListener('wheel', (e) => this._onWheel(e), { passive: true });
    target.addEventListener('blur', () => this.clear());
    target.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
  }

  clear() {
    this.keys.clear();
    this.pressed.clear();
    this.mouseDown = false;
    this.rightDown = false;
    this.orbit.x = this.orbit.y = 0;
  }

  _touch() { this.lastActivity = performance.now(); }

  _onKey(e, down) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.enabled && PREVENT.has(e.code)) e.preventDefault();
    if (down) {
      this._touch();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (ATTACK_KEYS.has(e.code)) this.attackSource = 'key';
    } else {
      this.keys.delete(e.code);
    }
  }

  _onMouse(e, down) {
    if (e.button === 2) {
      if (down && e.target instanceof Element && e.target.closest('button, a, input, select, textarea, [data-ui-block]')) return;
      this.rightDown = down && this.enabled;
      if (down) this._touch();
      return;
    }
    if (e.button !== 0) return;
    if (down) {
      // Cliques em elementos interativos da UI não atacam.
      if (e.target instanceof Element && e.target.closest('button, a, input, select, textarea, [data-ui-block]')) return;
      this._touch();
      this.attackSource = 'mouse';
      this.pressed.add('Mouse0');
    }
    this.mouseDown = down;
  }

  _onMove(e) {
    this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    this.pointer.inside = true;
    if (this.rightDown) { this.orbit.x += e.movementX || 0; this.orbit.y += e.movementY || 0; }
  }

  _onWheel(e) {
    this._touch();
    this.wheel += Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120) / 120;
  }

  isDown(code) { return this.keys.has(code); }
  wasPressed(code) { return this.pressed.has(code); }

  /** Eixo de movimento bruto: x = direita(+), y = frente(+). Vazio se desabilitado. */
  axis(out = { x: 0, y: 0 }) {
    out.x = 0; out.y = 0;
    if (!this.enabled) return out;
    for (const k of this.keys) {
      const m = MOVE_KEYS[k];
      if (m) { out.x += m[0]; out.y += m[1]; }
    }
    const len = Math.hypot(out.x, out.y);
    if (len > 1) { out.x /= len; out.y /= len; }
    return out;
  }

  get run() { return this.enabled && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')); }
  get interactPressed() { return this.enabled && this.pressed.has('KeyE'); }

  /** Ataque pedido neste quadro: botão/tecla segurado OU apertado e solto dentro do mesmo quadro. */
  get attackHeld() {
    if (!this.enabled) return false;
    return this.mouseDown || this.keys.has('Space') || this.keys.has('KeyJ')
      || this.pressed.has('Mouse0') || this.pressed.has('Space') || this.pressed.has('KeyJ');
  }

  /** Retorna e zera o arrasto acumulado do botão direito (px). */
  consumeOrbit(out = { x: 0, y: 0 }) {
    out.x = this.orbit.x; out.y = this.orbit.y;
    this.orbit.x = this.orbit.y = 0;
    return out;
  }

  /** Retorna e zera o acumulado da roda do mouse. */
  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }

  /** Chamar no fim de cada quadro. */
  endFrame() { this.pressed.clear(); }
}
