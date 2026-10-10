import * as THREE from 'three';
import { GOLD_PALETTE } from './CombatFx.js';
import { LINE_ALL_STRAWBERRIES, STRAWBERRY, TOAST_ALL_STRAWBERRIES } from './configWorld.js';

/**
 * Os 12 morangos dourados escondidos no Vale: clones do `Prop_GoldenStrawberry` que flutuam e giram em cada
 * `ITEM_Strawberry_##`. Encostar coleta (faíscas, Cheer, contador na UI). Os já coletados ficam salvos no navegador.
 * É um "system" do Game (update(dt)).
 */
export class Strawberries {
  /** @param {import('./Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.world = null;
    this.items = [];      // {id, node, base:{x,z}, phase, got}
    this.found = new Set(this._load());
    this.time = 0;
    this.active = false;
    this.count = this.found.size;
    this.done = false;
  }

  _load() {
    try { return JSON.parse(localStorage.getItem(STRAWBERRY.storageKey) || '[]'); } catch { return []; }
  }

  _save() {
    try { localStorage.setItem(STRAWBERRY.storageKey, JSON.stringify([...this.found])); } catch { /* sem armazenamento */ }
  }

  /** Cria os morangos no mundo externo (os já coletados não aparecem). */
  setup(world) {
    this.dispose();
    this.world = world;
    const tpl = world.strawberryTemplate;
    if (!tpl) return;
    for (const it of world.items) {
      const got = this.found.has(it.id);
      const node = tpl.clone(true);
      node.visible = !got;
      node.position.set(it.pos.x, STRAWBERRY.hoverY, it.pos.z);
      node.rotation.set(0, Math.random() * 6, 0);
      node.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.visible = true; } });
      world.root.add(node);
      this.items.push({ id: it.id, node, x: it.pos.x, z: it.pos.z, phase: Math.random() * 6.28, got });
    }
    this.count = this.items.filter((i) => i.got).length;
    this.done = this.count >= STRAWBERRY.total;
  }

  dispose() {
    for (const it of this.items) it.node.parent?.remove(it.node);
    this.items = [];
  }

  setActive(on) {
    this.active = on && this.items.length > 0;
    if (this.active) this.game.ui.setCounter?.('morangos', '🍓', this.count, STRAWBERRY.total);
    else this.game.ui.setCounter?.('morangos', null);
  }

  /** Apaga o progresso salvo (dev). */
  reset() {
    this.found.clear();
    this._save();
    for (const it of this.items) { it.got = false; it.node.visible = true; }
    this.count = 0;
    this.done = false;
    this.game.ui.setCounter?.('morangos', '🍓', 0, STRAWBERRY.total);
  }

  update(dt) {
    if (!this.active) return;
    this.time += dt;
    const p = this.game.player;
    const R = STRAWBERRY.pickupRadius;
    for (const it of this.items) {
      if (it.got) continue;
      it.node.rotation.y += dt * 1.7;
      it.node.position.y = STRAWBERRY.hoverY + Math.sin(this.time * 2.2 + it.phase) * 0.06;
      if (p.defeated || this.game.transitioning) continue;
      if (Math.hypot(p.pos.x - it.x, p.pos.z - it.z) < R) this._collect(it);
    }
  }

  _collect(it) {
    const g = this.game;
    it.got = true;
    it.node.visible = false;
    this.found.add(it.id);
    this._save();
    this.count++;
    g.sparkles.burst(it.x, STRAWBERRY.hoverY + 0.1, it.z, 30, { speed: 1.7, life: 0.95, size: 0.085, gravity: -0.6, palette: GOLD_PALETTE });
    g.texts.spawn('+1', it.x, STRAWBERRY.hoverY + 0.45, it.z, { scale: 0.62 });
    g.ui.setCounter('morangos', '🍓', this.count, STRAWBERRY.total);
    const p = g.player;
    if (!p.busy && !p.locked && !p.script) p.playAction('Cheer', { cancelAfter: 'hop' });
    if (this.count >= STRAWBERRY.total && !this.done) {
      this.done = true;
      g.ui.toast?.(TOAST_ALL_STRAWBERRIES, 4000);
      setTimeout(() => g.say(LINE_ALL_STRAWBERRIES, { duration: 5200 }), 700);
    } else {
      g.ui.toast?.(`Morango dourado! ${this.count}/${STRAWBERRY.total}`, 1800);
    }
  }
}
