import './ui.css';

// Interface DOM do jogo (ver docs/CONTRATO.md, "API da UI").

const FONT_URL = 'https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap';
const TYPE_CPS = 35;        // velocidade da digitação do balão (letras por segundo)
const BUBBLE_OUT_MS = 200;  // duração da animação de saída do balão antes de resolver
const TAIL = 16;            // altura da cauda do balão (px): a ponta cai exatamente na âncora
const EDGE = 12;            // distância mínima das bordas da tela (px)

const TEMPLATE = `
  <div class="ui-loading" hidden>
    <div class="ui-loading-card">
      <p class="ui-loading-label"><i class="ui-spark"></i>Preparando a magia</p>
      <div class="ui-loading-track"><div class="ui-loading-fill"></div></div>
      <p class="ui-loading-pct">0%</p>
    </div>
  </div>
  <div class="ui-title">
    <div class="ui-stars"></div>
    <div class="ui-title-box">
      <span class="ui-ear ui-ear-l"></span>
      <span class="ui-ear ui-ear-r"></span>
      <h1 class="ui-title-name"></h1>
      <p class="ui-title-sub">Uma pequena bruxa, dois gatinhos e muita magia</p>
    </div>
    <p class="ui-title-start">Clique ou aperte <kbd class="ui-key ui-key-sm">Enter</kbd> para começar</p>
  </div>
  <div class="ui-hp" hidden>
    <svg class="ui-heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.1C.9 8.6 2.6 4.5 6.5 4.5c2.2 0 3.7 1.3 5.5 3.2 1.8-1.9 3.3-3.2 5.5-3.2 3.9 0 5.6 4.1 4.1 7.4C19.5 16.4 12 21 12 21z"/></svg>
    <div class="ui-hp-track"><div class="ui-hp-fill"></div></div>
    <span class="ui-hp-num">0/0</span>
  </div>
  <div class="ui-bubble">
    <div class="ui-bubble-center">
      <div class="ui-bubble-card">
        <span class="ui-bubble-tag">Aprendiz</span>
        <p class="ui-bubble-text"><span class="ui-done"></span><span class="ui-todo"></span></p>
      </div>
    </div>
  </div>
  <div class="ui-prompt"><div class="ui-prompt-pill"></div></div>
  <div class="ui-hint"><div class="ui-hint-pill"></div></div>
  <div class="ui-counters" hidden></div>
  <div class="ui-area">
    <div class="ui-area-card">
      <h2 class="ui-area-title"></h2>
      <p class="ui-area-sub"></p>
    </div>
  </div>
  <div class="ui-toasts"></div>
  <div class="ui-pause" role="dialog" aria-label="Pausado">
    <div class="ui-pause-card">
      <h2 class="ui-pause-title">Pausado</h2>
      <table class="ui-controls"><tbody></tbody></table>
      <button class="ui-pause-btn" type="button">Continuar</button>
    </div>
  </div>
  <div class="ui-shelf" role="dialog" aria-modal="true" aria-labelledby="ui-shelf-title">
    <div class="ui-shelf-panel">
      <h2 class="ui-shelf-title" id="ui-shelf-title">Estante da Aprendiz</h2>
      <div class="ui-shelf-board"></div>
      <div class="ui-shelf-caption">
        <span class="ui-shelf-tag" hidden>Aprendiz</span>
        <p class="ui-shelf-text"><span class="ui-done"></span><span class="ui-todo"></span></p>
      </div>
      <button class="ui-shelf-close" type="button">Fechar</button>
    </div>
  </div>
  <div class="ui-fade"></div>
`;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Reinicia uma animação CSS removendo e recolocando a classe (com reflow entre os dois).
function restartClass(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function ensureFont() {
  if (document.getElementById('ui-font-fredoka')) return;
  const links = [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
    { id: 'ui-font-fredoka', rel: 'stylesheet', href: FONT_URL },
  ];
  for (const attrs of links) {
    const link = document.createElement('link');
    Object.assign(link, attrs);
    document.head.appendChild(link);
  }
}

// "A Aprendiz" -> letras em spans, para a animação de ondulação do título.
function titleLetters(text) {
  let i = 0;
  return Array.from(text, (ch) => {
    if (ch === ' ') return '<span class="ui-sp"></span>';
    const gold = i === 0 ? ' is-gold' : '';
    return `<span class="ui-letter${gold}" style="--i:${i++}">${ch}</span>`;
  }).join('');
}

function starsHTML(count) {
  const colors = ['#FFF6E6', '#E0AE45', '#CFA9E6'];
  let html = '';
  for (let i = 0; i < count; i++) {
    const x = (Math.random() * 100).toFixed(1);
    const y = (Math.random() * 100).toFixed(1);
    const s = (7 + Math.random() * 11).toFixed(0);
    const d = (Math.random() * 4).toFixed(2);
    const dur = (2.2 + Math.random() * 2.6).toFixed(2);
    html += `<i class="ui-star" style="--x:${x}%;--y:${y}%;--s:${s}px;--c:${colors[i % colors.length]};--d:${d}s;--dur:${dur}s"></i>`;
  }
  return html;
}

// "E  Abrir geladeira" -> tecla "E" + texto. Também aceita "[E] Abrir geladeira".
function parsePrompt(text) {
  const bracket = /^\s*\[([^\]]{1,12})\]\s*(.*)$/.exec(text);
  if (bracket) return { key: bracket[1], label: bracket[2] };
  const spaced = /^\s*(\S{1,10})\s{2,}(.*)$/.exec(text);
  if (spaced) return { key: spaced[1], label: spaced[2] };
  return { key: '', label: text.trim() };
}

const AREA_HOLD_MS = 2500;  // faixa de região visível por este tempo (+ 500 ms de fade)
const TOAST_MAX = 3;        // máximo de notificações empilhadas

// Controles mostrados na pausa. "/" e "+" viram separadores entre as teclas.
const CONTROLS = [
  ['WASD / setas', 'Andar'],
  ['Shift', 'Correr'],
  ['E', 'Interagir'],
  ['Espaço / J / clique', 'Ataque mágico'],
  ['Roda do mouse', 'Zoom'],
  ['Botão direito + arrastar', 'Girar a câmera'],
  ['C', 'Close no rosto'],
  ['Esc', 'Pausa'],
];

function controlParts(text) {
  return text.split(/\s*([\/+])\s*/).filter((p) => p !== '');
}

const SPINE_HEIGHTS = [248, 262, 240, 270, 254, 244, 266]; // alturas variadas das lombadas (px)

// Digitação com o mesmo truque do balão: o texto inteiro ocupa espaço e a parte
// não digitada fica transparente. Devolve uma função que cancela a digitação.
function typeInto(doneEl, todoEl, text) {
  const chars = Array.from(String(text ?? ''));
  const t0 = performance.now();
  let shown = -1;
  let timer = 0;
  const tick = () => {
    const n = Math.min(chars.length, Math.floor(((performance.now() - t0) * TYPE_CPS) / 1000));
    if (n !== shown) {
      shown = n;
      doneEl.textContent = chars.slice(0, n).join('');
      todoEl.textContent = chars.slice(n).join('');
    }
    if (n < chars.length) timer = setTimeout(tick, 15);
  };
  tick();
  return () => clearTimeout(timer);
}

// Lombada (livro) ou Kindle dentro de um slot da estante.
function buildShelfSlot(item, index) {
  const slot = document.createElement('div');
  slot.className = 'ui-slot';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ui-item';
  btn.setAttribute('aria-label', String(item.title ?? ''));
  const body = document.createElement('span');
  const color = /^#[0-9a-f]{3,8}$/i.test(item.color ?? '') ? item.color : null;
  if (item.kind === 'kindle') {
    slot.classList.add('is-wide');
    body.className = 'ui-kindle';
  } else {
    body.className = 'ui-spine';
    body.style.setProperty('--h', `${SPINE_HEIGHTS[index % SPINE_HEIGHTS.length]}px`);
    const label = document.createElement('span');
    label.className = 'ui-spine-title';
    label.textContent = String(item.title ?? '');
    body.appendChild(label);
  }
  if (color) body.style.setProperty('--c', color);
  btn.appendChild(body);
  slot.appendChild(btn);
  return { slot, btn };
}

export class UI {
  constructor(rootElement) {
    ensureFont();
    this.root = rootElement || document.body;
    this.el = document.createElement('div');
    this.el.className = 'ui-root';
    this.el.innerHTML = TEMPLATE;
    this.root.appendChild(this.el);

    const $ = (sel) => this.el.querySelector(sel);
    this._loading = $('.ui-loading');
    this._loadFill = $('.ui-loading-fill');
    this._loadPct = $('.ui-loading-pct');
    this._title = $('.ui-title');
    this._titleName = $('.ui-title-name');
    this._hp = $('.ui-hp');
    this._hpTrack = $('.ui-hp-track');
    this._hpFill = $('.ui-hp-fill');
    this._hpNum = $('.ui-hp-num');
    this._bubble = $('.ui-bubble');
    this._bubbleCard = $('.ui-bubble-card');
    this._bubbleTag = $('.ui-bubble-tag');
    this._bubbleDone = $('.ui-done');
    this._bubbleTodo = $('.ui-todo');
    this._prompt = $('.ui-prompt');
    this._promptPill = $('.ui-prompt-pill');
    this._hint = $('.ui-hint');
    this._hintPill = $('.ui-hint-pill');
    this._fade = $('.ui-fade');
    this._counters = $('.ui-counters');
    this._area = $('.ui-area');
    this._areaCard = $('.ui-area-card');
    this._areaTitle = $('.ui-area-title');
    this._areaSub = $('.ui-area-sub');
    this._toasts = $('.ui-toasts');
    this._pause = $('.ui-pause');
    this._pauseBtn = $('.ui-pause-btn');
    this._pauseRows = $('.ui-controls tbody');

    this._counterMap = new Map();
    this._areaTimer = 0;
    this._paused = false;
    this._buildControls();
    this._pauseBtn.addEventListener('click', () => this.togglePause(false));
    this._shelf = $('.ui-shelf');
    this._shelfTitle = $('.ui-shelf-title');
    this._shelfBoard = $('.ui-shelf-board');
    this._shelfTag = $('.ui-shelf-tag');
    this._shelfDone = this._shelf.querySelector('.ui-shelf-text .ui-done');
    this._shelfTodo = this._shelf.querySelector('.ui-shelf-text .ui-todo');
    this._shelfWait = null;
    this._shelfBtns = [];
    this._shelfCancel = null;
    $('.ui-shelf-close').addEventListener('click', () => this._closeShelf());

    this._titleName.setAttribute('aria-label', 'A Aprendiz');
    this._titleName.innerHTML = titleLetters('A Aprendiz');
    $('.ui-stars').innerHTML = starsHTML(22);

    this._loadTimer = 0;
    this._hpShown = false;
    this._hpCur = null;
    this._promptOn = false;
    this._hintTimer = 0;
    this._titleWait = null;
    this._say = null;
    this._ax = window.innerWidth / 2;
    this._ay = window.innerHeight * 0.4;
    this._anchorOn = true;
    this._placeBubble();

    window.addEventListener('resize', () => this._placeBubble());
  }

  // Barra de carregamento. Some quando progress chega a 1.
  setLoading(progress) {
    const p = clamp(Number(progress) || 0, 0, 1);
    this._loadFill.style.width = `${(p * 100).toFixed(1)}%`;
    this._loadPct.textContent = `${Math.round(p * 100)}%`;
    clearTimeout(this._loadTimer);
    if (p >= 1) {
      this._loading.classList.add('is-done');
      this._loadTimer = setTimeout(() => { this._loading.hidden = true; }, 500);
    } else {
      this._loading.hidden = false;
      this._loading.classList.remove('is-done');
    }
  }

  // Mostra o título. A Promise resolve com clique ou Enter/Espaço.
  // O título só some quando hideTitle() for chamado.
  showTitle() {
    this._title.classList.add('is-on');
    if (this._titleWait) return this._titleWait.promise;

    const wait = {};
    wait.promise = new Promise((resolve) => { wait.resolve = resolve; });
    wait.onKey = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.repeat) return;
      // Não rouba a tecla de campos de texto (ex.: a página de teste).
      const field = e.target instanceof Element
        ? e.target.closest('input, textarea, select, [contenteditable="true"]')
        : null;
      if (field) return;
      e.preventDefault();
      this._endTitleWait(wait);
    };
    wait.onClick = () => this._endTitleWait(wait);
    wait.detach = () => {
      window.removeEventListener('keydown', wait.onKey);
      this._title.removeEventListener('click', wait.onClick);
    };
    window.addEventListener('keydown', wait.onKey);
    this._title.addEventListener('click', wait.onClick);
    this._titleWait = wait;
    return wait.promise;
  }

  _endTitleWait(wait) {
    if (this._titleWait !== wait) return;
    this._titleWait = null;
    wait.detach();
    wait.resolve();
  }

  // Esconde o título (com fade). Uma showTitle() ainda pendente é descartada.
  hideTitle() {
    this._title.classList.remove('is-on');
    if (this._titleWait) {
      const wait = this._titleWait;
      this._titleWait = null;
      wait.detach();
    }
  }

  // Tela preta: 1 = preta, 0 = transparente. Resolve quando o fade termina.
  fade(toOpacity, ms = 500) {
    const dur = Math.max(0, Number(ms) || 0);
    const target = clamp(Number(toOpacity) || 0, 0, 1);
    this._fade.style.transitionDuration = `${dur}ms`;
    this._fade.style.opacity = String(target);
    return new Promise((resolve) => setTimeout(resolve, dur));
  }

  // Prompt de interação, ex.: "E  Abrir geladeira" (a tecla vira keycap).
  showPrompt(text) {
    const wasOn = this._promptOn;
    const { key, label } = parsePrompt(String(text ?? ''));
    const pill = this._promptPill;
    pill.textContent = '';
    if (key) {
      const cap = document.createElement('kbd');
      cap.className = 'ui-key';
      cap.textContent = key;
      pill.appendChild(cap);
    }
    const span = document.createElement('span');
    span.textContent = label;
    pill.appendChild(span);
    pill.classList.toggle('has-key', !!key);

    this._promptOn = true;
    this._prompt.classList.add('is-on');
    if (!wasOn) restartClass(pill, 'is-pop');
  }

  hidePrompt() {
    this._promptOn = false;
    this._prompt.classList.remove('is-on');
  }

  // Balão de fala com digitação. A Promise resolve quando o balão fecha.
  // Um novo say() substitui o atual e resolve a Promise anterior.
  say(text, opts = {}) {
    const { duration = 3500, speaker = 'Aprendiz' } = opts || {};
    this._cancelSay();

    const chars = Array.from(String(text ?? ''));
    const s = { closing: false, typer: 0, closer: 0, out: 0, resolve: null };
    const promise = new Promise((resolve) => { s.resolve = resolve; });
    this._say = s;

    this._bubbleTag.textContent = speaker ?? '';
    this._bubbleTag.hidden = !speaker;
    // O texto inteiro já ocupa espaço (parte invisível), então o balão não muda de tamanho enquanto digita.
    this._bubbleDone.textContent = '';
    this._bubbleTodo.textContent = chars.join('');
    this._bubbleCard.classList.remove('is-out');
    this._bubble.classList.add('is-show');
    restartClass(this._bubbleCard, 'is-pop');
    this._placeBubble();

    const t0 = performance.now();
    let shown = 0;
    const tick = () => {
      if (this._say !== s) return;
      const n = Math.min(chars.length, Math.floor(((performance.now() - t0) * TYPE_CPS) / 1000));
      if (n !== shown) {
        shown = n;
        this._bubbleDone.textContent = chars.slice(0, n).join('');
        this._bubbleTodo.textContent = chars.slice(n).join('');
      }
      if (n < chars.length) {
        s.typer = setTimeout(tick, 15);
      } else {
        s.closer = setTimeout(() => this._closeSay(s), Math.max(0, duration));
      }
    };
    tick();
    return promise;
  }

  _closeSay(s) {
    if (this._say !== s || s.closing) return;
    s.closing = true;
    clearTimeout(s.typer);
    clearTimeout(s.closer);
    this._bubbleCard.classList.remove('is-pop');
    this._bubbleCard.classList.add('is-out');
    s.out = setTimeout(() => {
      if (this._say === s) {
        this._say = null;
        this._bubble.classList.remove('is-show');
        this._bubbleCard.classList.remove('is-out');
      }
      s.resolve();
    }, BUBBLE_OUT_MS);
  }

  _cancelSay() {
    const s = this._say;
    if (!s) return;
    this._say = null;
    clearTimeout(s.typer);
    clearTimeout(s.closer);
    clearTimeout(s.out);
    s.resolve();
  }

  // Posição, em pixels, do ponto sob a cauda do balão. Chamada a cada quadro.
  // visible = false esconde o balão sem fechar a fala.
  setBubbleAnchor(x, y, visible = true) {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      this._ax = x;
      this._ay = y;
    }
    this._anchorOn = !!visible;
    this._placeBubble();
  }

  // Posiciona o balão: centralizado na âncora, sem sair da tela; vira para baixo se não couber em cima.
  _placeBubble() {
    const card = this._bubbleCard;
    const w = card.offsetWidth;
    const h = card.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const half = w / 2;
    const lo = EDGE + half;
    const hi = vw - EDGE - half;
    const cx = lo <= hi ? clamp(this._ax, lo, hi) : vw / 2;
    const reach = Math.max(0, half - 24);
    const tail = clamp(this._ax - cx, -reach, reach);
    const flip = this._ay - TAIL - h < EDGE && this._ay + TAIL + h <= vh - EDGE;

    this._bubble.style.transform = `translate3d(${cx.toFixed(1)}px, ${this._ay.toFixed(1)}px, 0)`;
    card.style.setProperty('--tx', `${tail.toFixed(1)}px`);
    this._bubble.classList.toggle('is-flip', flip);
    this._bubble.classList.toggle('is-off', !this._anchorOn);
  }

  // Dica temporária no rodapé. ms <= 0 deixa a dica até a próxima chamada.
  showHint(text, ms = 4000) {
    const pill = this._hintPill;
    const str = String(text ?? '');
    clearTimeout(this._hintTimer);
    if (!str) {
      this._hint.classList.remove('is-on');
      return;
    }
    pill.textContent = str;
    restartClass(pill, 'is-pop');
    this._hint.classList.add('is-on');
    if (ms > 0) {
      this._hintTimer = setTimeout(() => this._hint.classList.remove('is-on'), ms);
    }
  }

  // Barra de vida no canto superior esquerdo. Fica escondida até a primeira chamada.
  setHP(cur, max) {
    const mx = Math.max(0, Number(max) || 0);
    const c = clamp(Number(cur) || 0, 0, mx);
    const pct = mx > 0 ? (c / mx) * 100 : 0;
    const hp = this._hp;

    if (!this._hpShown) {
      this._hpShown = true;
      hp.hidden = false;
      restartClass(hp, 'is-in');
    }
    if (this._hpCur !== null && c < this._hpCur) restartClass(this._hpTrack, 'is-hurt');
    this._hpCur = c;

    this._hpFill.style.width = `${pct.toFixed(1)}%`;
    this._hpNum.textContent = `${c}/${mx}`;
    hp.classList.toggle('is-low', pct <= 25);
    hp.classList.toggle('is-mid', pct > 25 && pct <= 50);
  }

  // Contador de coleta no canto superior direito, ex.: setCounter('morangos', '🍓', 3, 12) -> "3/12".
  // Vários contadores empilham. setCounter(key, null) remove o contador (n ausente).
  // Quando n sobe, o contador dá um pulo e pisca dourado.
  setCounter(key, icon, n, total) {
    const id = String(key);
    if (n === null || n === undefined) {
      const old = this._counterMap.get(id);
      if (old) {
        old.el.remove();
        this._counterMap.delete(id);
      }
      this._counters.hidden = this._counterMap.size === 0;
      return;
    }

    let entry = this._counterMap.get(id);
    if (!entry) {
      const el = document.createElement('div');
      el.className = 'ui-counter';
      const iconEl = document.createElement('span');
      iconEl.className = 'ui-counter-icon';
      const text = document.createElement('span');
      text.className = 'ui-counter-text';
      el.append(iconEl, text);
      this._counters.appendChild(el);
      entry = { el, iconEl, text, n: null };
      this._counterMap.set(id, entry);
      restartClass(el, 'is-pop');
    }
    this._counters.hidden = false;

    entry.iconEl.textContent = icon ? String(icon) : '';
    entry.iconEl.hidden = !icon;
    const value = Number(n) || 0;
    entry.text.textContent = total === undefined || total === null ? `${value}` : `${value}/${total}`;
    if (entry.n !== null && value > entry.n) restartClass(entry.el, 'is-bump');
    entry.n = value;
  }

  // Faixa elegante no topo, ao entrar numa região: aparece, fica ~2,5 s e some.
  // Uma nova chamada substitui a atual.
  showAreaTitle(title, subtitle) {
    clearTimeout(this._areaTimer);
    this._areaTitle.textContent = String(title ?? '');
    this._areaSub.textContent = subtitle ? String(subtitle) : '';
    this._area.classList.add('is-on');
    restartClass(this._areaCard, 'is-in');
    this._areaTimer = setTimeout(() => this._area.classList.remove('is-on'), AREA_HOLD_MS);
  }

  // Pausa: abre/fecha o painel com os controles. open = true/false; sem argumento alterna.
  // Devolve o novo estado. Emite window 'pause' com detail {open} quando o estado muda.
  // O Esc não é tratado aqui: o jogo chama togglePause().
  togglePause(open) {
    const next = open === undefined ? !this._paused : !!open;
    if (next === this._paused) return next;
    this._paused = next;
    this._pause.classList.toggle('is-open', next);
    if (next) this._pauseBtn.focus({ preventScroll: true });
    window.dispatchEvent(new CustomEvent('pause', { detail: { open: next } }));
    return next;
  }

  // Notificação pequena no topo, abaixo da faixa de região. Some depois de `ms`.
  toast(text, ms = 2500) {
    const el = document.createElement('div');
    el.className = 'ui-toast';
    el.textContent = String(text ?? '');
    this._toasts.appendChild(el);
    while (this._toasts.children.length > TOAST_MAX) this._toasts.firstElementChild.remove();
    setTimeout(() => {
      el.classList.add('is-out');
      setTimeout(() => el.remove(), 280);
    }, Math.max(0, ms));
  }

  _buildControls() {
    const frag = document.createDocumentFragment();
    for (const [keys, label] of CONTROLS) {
      const tr = document.createElement('tr');
      const tdKeys = document.createElement('td');
      for (const part of controlParts(keys)) {
        if (part === '/' || part === '+') {
          const sep = document.createElement('span');
          sep.className = 'ui-sep';
          sep.textContent = part;
          tdKeys.appendChild(sep);
        } else {
          const cap = document.createElement('kbd');
          cap.className = 'ui-key';
          cap.textContent = part;
          tdKeys.appendChild(cap);
        }
      }
      const tdLabel = document.createElement('td');
      tdLabel.textContent = label;
      tr.append(tdKeys, tdLabel);
      frag.appendChild(tr);
    }
    this._pauseRows.appendChild(frag);
  }

  // Estante de livros (overlay com cliques). items = [{ id, kind: 'book'|'kindle', title, color, line }].
  // Setas ←/→ movem, Enter lê a contracapa (mostra `line` numa fala do Aprendiz),
  // Esc, E ou "Fechar" fecham. A Promise resolve ao fechar. Emite window 'bookshelf' {open}.
  showBookshelf(items, opts = {}) {
    if (this._shelfWait) this._closeShelf();
    const list = Array.isArray(items) ? items : [];
    this._shelfTitle.textContent = (opts && opts.title) || 'Estante da Aprendiz';
    this._shelfBoard.textContent = '';
    this._shelfBtns = [];
    this._shelfTag.hidden = true;
    this._shelfDone.textContent = 'Use ← → para escolher e Enter para ler.';
    this._shelfTodo.textContent = '';

    list.forEach((item, i) => {
      const { slot, btn } = buildShelfSlot(item, i);
      btn.addEventListener('click', () => this._shelfSelect(item));
      this._shelfBoard.appendChild(slot);
      this._shelfBtns.push(btn);
    });

    const wait = {};
    wait.promise = new Promise((resolve) => { wait.resolve = resolve; });
    wait.onKey = (e) => this._shelfKey(e);
    // Captura: o jogo não recebe as teclas enquanto a estante está aberta (ex.: Esc não pausa).
    window.addEventListener('keydown', wait.onKey, true);
    this._shelfWait = wait;
    this._shelf.classList.add('is-open');
    window.dispatchEvent(new CustomEvent('bookshelf', { detail: { open: true } }));
    if (this._shelfBtns[0]) this._shelfBtns[0].focus({ preventScroll: true });
    return wait.promise;
  }

  _shelfSelect(item) {
    this._shelfTag.hidden = false;
    this._shelfTag.textContent = 'Aprendiz';
    if (this._shelfCancel) this._shelfCancel();
    this._shelfCancel = typeInto(this._shelfDone, this._shelfTodo, item.line ?? '');
  }

  _shelfKey(e) {
    const btns = this._shelfBtns;
    const idx = btns.indexOf(document.activeElement);
    if (e.key === 'Escape' || e.key === 'e' || e.key === 'E') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this._closeShelf();
      return;
    }
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && btns.length) {
      e.preventDefault();
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      const next = clamp(idx < 0 ? 0 : idx + dir, 0, btns.length - 1);
      btns[next].focus({ preventScroll: true });
    }
    // Enter não é tratado aqui: o botão focado já dispara o clique (leitura).
    e.stopImmediatePropagation();
  }

  _closeShelf() {
    const wait = this._shelfWait;
    if (!wait) return;
    this._shelfWait = null;
    window.removeEventListener('keydown', wait.onKey, true);
    if (this._shelfCancel) this._shelfCancel();
    this._shelfCancel = null;
    this._shelf.classList.remove('is-open');
    window.dispatchEvent(new CustomEvent('bookshelf', { detail: { open: false } }));
    wait.resolve();
  }
}
