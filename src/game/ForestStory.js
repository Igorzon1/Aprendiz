import * as THREE from 'three';
import { GOLD_PALETTE } from './CombatFx.js';
import {
  LINE_GATE_OPEN, LINE_GATE_TRY, OBJ_ENTER_FOREST, PROMPT_GATE_ENTER, PROMPT_GATE_OPEN_TRY,
} from './configForest.js';
import { LINE_GATE } from './configWorld.js';
import { clamp, rand, smoothstep, wait } from './util.js';

const LEAF = [[0.7, 2.0, 0.8], [1.0, 2.2, 0.9], [0.5, 1.8, 1.2]];
const RUNES = [[1.7, 0.7, 2.6], [2.0, 1.1, 2.6], [1.2, 0.5, 2.2]];

/**
 * v0.4, o caminho até a Floresta Sombria no Vale:
 *  - gancho: depois do Broto Guardião (flags.sproutSpell), a Divonica conta dos morangos roubados (sequência `forestHook`
 *    do Story.js), numa conversa ou sozinha quando a Aprendiz chega perto dela (uma vez);
 *  - a barreira (GATEBAR_Forest + COL_Gate_Forest) se abre com a magia de planta e o portão vira "Entrar na Floresta".
 * É um "system" do Game.
 */
export class ForestStory {
  /** @param {import('./Game.js').Game} game */
  constructor(game) {
    this.game = game;
    this.armT = 0;
    this.open = false;
    const w = game.outdoorWorld;
    this.bar = w?.byName.get('GATEBAR_Forest') ?? null;
    this.item = w?.interactables.find((i) => i.id === 'INT_Gate_Forest') ?? null;
    this.gatePos = w?.byName.get('GATE_Forest')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(-27.1, 0, 0);
    if (this.bar) { this.bar.material = this.bar.material.clone(); }
  }

  get sproutSpell() { return !!this.game.state.flags.sproutSpell; }

  /** Voltou ao Vale: o interativo da barreira reflete o estado dela. */
  onOutdoorEntered() {
    this._syncItem();
    const g = this.game;
    if (this.sproutSpell && g.story.flags['done:forestHook'] && !g.story.flags.druidDefeated) g.ui.setObjective?.(OBJ_ENTER_FOREST);
  }

  _syncItem() {
    const it = this.item;
    if (!it) return;
    if (this.open) {
      it.kind = 'forest_enter';
      it.prompt = PROMPT_GATE_ENTER;
      it.radius = 1.3;
      it.pos.set(this.gatePos.x + 0.9, 0, this.gatePos.z);
    } else if (this.sproutSpell && this.game.forestWorld) {
      it.prompt = PROMPT_GATE_OPEN_TRY;
    }
  }

  update(dt) {
    const g = this.game;
    const p = g.player;
    this._syncItem();
    if (this.open && g.scenes.current === 'outdoor' && !p.locked && !g.transitioning && !g.interaction.busy && !p.defeated && g.input.enabled) {
      if (p.pos.x < this.gatePos.x + 1.0 && Math.abs(p.pos.z - this.gatePos.z) < 2.6) g.interaction.trigger(this.item);   // passou pela barreira aberta
    }

    // gancho com a Divonica (uma vez, quando a Aprendiz chega perto dela, já livre depois da magia)
    const f = g.story.flags;
    if (!this.sproutSpell || f['done:forestHook'] || g.scenes.current !== 'outdoor' || g.garden?.celebrating) { this.armT = 0; return; }
    const npc = g.npcs.Divonica;
    if (!npc || !npc.root.visible) return;
    if (p.locked || p.busy || p.script || p.defeated || g.transitioning || !g.input.enabled || g.interaction.busy) return;
    this.armT += dt;
    if (this.armT < 3 || Math.hypot(p.pos.x - npc.pos.x, p.pos.z - npc.pos.z) > 6) return;
    g.story.play('forestHook');
  }

  /** E na barreira. */
  async interact(item) {
    const g = this.game;
    if (this.open) { await this.enter(); return; }
    await g.player.turnTo(this.gatePos);
    if (!this.sproutSpell || !g.forestWorld) {                 // sem a magia de planta: "Em breve"
      g.sparkles.burst(item.pos.x, 0.9, item.pos.z, 10, { speed: 0.8, life: 0.7, size: 0.06, gravity: 0.2 });
      await g.say(LINE_GATE(item.area ?? 'este lugar'));
      return;
    }
    await this.openGate();
    await this.enter();
  }

  async enter() {
    await this.game.scenes.go('forest');
  }

  /** Cena curta: ela conjura, as runas se soltam, as vinhas recuam e a barreira some. */
  async openGate() {
    const g = this.game, p = g.player, w = g.outdoorWorld;
    await g.say(LINE_GATE_TRY, { duration: 3000 });
    const cast = p.playAction('Cast_Lumos', { fade: 0.15 });
    const tip = new THREE.Vector3();
    // faíscas de folha da varinha até a barreira
    for (let i = 0; i < 14; i++) {
      p.wandTipWorld(tip);
      const dx = this.gatePos.x - tip.x, dz = this.gatePos.z - tip.z, d = Math.hypot(dx, dz) || 1;
      for (let k = 0; k < 3; k++) {
        const c = LEAF[(Math.random() * LEAF.length) | 0];
        g.sparkles.emit({ x: tip.x, y: tip.y, z: tip.z, vx: (dx / d) * 4.2 + rand(-0.3, 0.3), vy: rand(-0.1, 0.5), vz: (dz / d) * 4.2 + rand(-0.3, 0.3), life: d / 4.2, size: 0.07, r: c[0], g: c[1], b: c[2], gravity: 0, drag: 0.2 });
      }
      await wait(60);
    }
    await wait(300);
    // as runas se soltam e a membrana se desfaz
    const bar = this.bar;
    const T = 1.8;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const step = () => {
        const k = clamp((performance.now() - t0) / (T * 1000), 0, 1);
        if (bar) {
          bar.scale.set(1, Math.max(0.02, 1 - smoothstep(k)), 1);
          bar.material.transparent = true;
          bar.material.opacity = 1 - smoothstep(k * 1.1);
        }
        if (Math.random() < 0.6) {
          const z = this.gatePos.z + rand(-3.0, 3.0);
          const c = RUNES[(Math.random() * RUNES.length) | 0];
          g.sparkles.emit({ x: this.gatePos.x + rand(-0.2, 0.2), y: rand(0.2, 2.8) * (1 - 0.5 * k), z, vx: rand(-0.2, 0.2), vy: rand(0.3, 1.0), vz: rand(-0.3, 0.3), life: rand(0.7, 1.3), size: rand(0.06, 0.11), r: c[0], g: c[1], b: c[2], gravity: -0.2, drag: 1.2 });
        }
        if (k >= 1) resolve(); else requestAnimationFrame(step);
        if (document.hidden && k < 1) setTimeout(() => { if (performance.now() - t0 < T * 1000 + 200) return; resolve(); }, T * 1000 + 250);
      };
      step();
    });
    if (bar) bar.visible = false;
    // colisor: some a faixa toda; as duas colunas continuam sólidas
    w.disableCollider('COL_Gate_Forest');
    const pillar = (z0, z1) => w.collision.addBox(new THREE.Box3(new THREE.Vector3(this.gatePos.x - 0.45, 0, z0), new THREE.Vector3(this.gatePos.x + 0.45, 3.4, z1)), 'COL_Gate_Forest_Pillar');
    pillar(this.gatePos.z + 2.85, this.gatePos.z + 4.0);
    pillar(this.gatePos.z - 4.0, this.gatePos.z - 2.85);
    g.outdoorNav?.rebuild();
    this.open = true;
    g.story.flags.forestOpen = true;
    this._syncItem();
    g.sparkles.burst(this.gatePos.x, 1.4, this.gatePos.z, 40, { speed: 2.4, life: 1.2, size: 0.09, gravity: -0.5, palette: GOLD_PALETTE });
    await cast;
    await g.say(LINE_GATE_OPEN, { duration: 3400 });
  }
}
