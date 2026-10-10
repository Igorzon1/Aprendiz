import { UI } from './ui/ui.js';
import { Assets } from './game/Assets.js';
import { Game } from './game/Game.js';

// Bootstrap: carrega os assets (com fallbacks), mostra o título e começa a partida.
async function main() {
  const ui = new UI(document.getElementById('ui'));
  ui.setLoading(0);

  const assets = await new Assets().loadAll((p) => ui.setLoading(p));
  const game = new Game({ container: document.getElementById('app'), ui, assets });
  game.start(); // o mundo já roda por trás do título (a Aprendiz fica em Idle)
  if (import.meta.env.DEV) window.__game = game; // depuração no console

  ui.setLoading(1);
  await ui.showTitle(); // só segue depois do clique/Enter (teclas só chegam ao jogo depois disso)

  // Tela preta de imediato (o título some por trás), depois a abertura clareia enquanto ela acorda.
  ui.fade(1, 0);
  ui.hideTitle();
  game.beginPlay();
}

main().catch((err) => {
  console.error('[Jogo da Aprendiz] erro fatal na inicialização:', err);
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;inset:0;margin:0;padding:24px;color:#ffd6e0;background:#2a2238;font:14px/1.5 monospace;white-space:pre-wrap;z-index:99';
  box.textContent = `Ops! Algo deu errado ao iniciar o jogo.\n\n${err?.stack || err}`;
  document.body.appendChild(box);
});
