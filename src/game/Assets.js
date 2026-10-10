import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildPlaceholderHouse, buildPlaceholderCat, buildPlaceholderApprentice } from './Placeholders.js';

const BASE = import.meta.env.BASE_URL || '/';
const MODELS = `${BASE}assets/models/`;
const DATA = `${BASE}assets/data/`;

/** Prefixos de arquivo que o exportador põe nos nomes dos clips: `<Arquivo>_<Clip>`. */
const CLIP_PREFIX = /^(ApprenticeSolo|Apprentice|Yumi|Petico|House|ShadowMinion|Divonica|World01)_/;

/**
 * O servidor de desenvolvimento do Vite responde index.html (200) para arquivos que não existem,
 * então "existe?" é decidido pelo magic number do GLB ("glTF"), não pelo status HTTP.
 */
async function fetchBuffer(url, onBytes) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const type = res.headers.get('content-type') || '';
  if (type.includes('text/html')) return null;

  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) {
    const buf = await res.arrayBuffer();
    onBytes?.(1);
    return buf;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onBytes?.(got / total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}

const isGLB = (buf) => !!buf && buf.byteLength > 12 && new DataView(buf).getUint32(0, true) === 0x46546c67;

/** Filtro Nearest + sem mipmaps nas texturas de paleta (arte pixelada / flat). */
function fixTexture(tex) {
  if (!tex || !tex.isTexture) return;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
}

function prepareScene(scene) {
  scene.traverse((o) => {
    if (o.isMesh || o.isSkinnedMesh) {
      if (o.isSkinnedMesh) o.frustumCulled = false; // bounding sphere do rest pose não vale para animações
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        for (const key of ['map', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) fixTexture(m[key]);
      }
    }
  });
}

export class Assets {
  constructor() {
    this.animData = {};
    /** @type {Record<string, {scene:THREE.Object3D, clips:Map<string,THREE.AnimationClip>, source:string, placeholder:boolean, events:object, fps:number, rig?:object}>} */
    this.models = {};
    this.log = [];
    this._loader = new GLTFLoader();
    this._loader.setMeshoptDecoder(MeshoptDecoder);
  }

  async _loadGLB(file, onProgress) {
    const buf = await fetchBuffer(MODELS + file, onProgress);
    if (!isGLB(buf)) return null;
    try {
      const gltf = await this._loader.parseAsync(buf, MODELS);
      const clips = new Map();
      for (const clip of gltf.animations) {
        const clean = clip.name.replace(CLIP_PREFIX, '');
        clip.name = clean;
        clips.set(clean, clip);
      }
      prepareScene(gltf.scene);
      return { scene: gltf.scene, clips };
    } catch (err) {
      console.warn(`[Assets] Falha ao ler ${file}:`, err);
      return null;
    }
  }

  async _loadJSON(file) {
    try {
      const res = await fetch(DATA + file);
      if (!res.ok) return {};
      return JSON.parse(await res.text());
    } catch {
      return {};
    }
  }

  /** Eventos/fps de um personagem; tenta cada chave em ordem (ex.: ApprenticeSolo, Apprentice). */
  _charData(...keys) {
    for (const k of keys) {
      const d = this.animData[k];
      if (d) return { events: d.events ?? {}, fps: d.fps ?? 30, speeds: d.speeds ?? null };
    }
    return { events: {}, fps: 30, speeds: null };
  }

  /**
   * Carrega tudo. `onProgress(0..1)`.
   * Cada modelo ausente é substituído por um placeholder com a mesma forma de dado.
   */
  async loadAll(onProgress = () => {}) {
    const jobs = [
      { key: 'apprentice', files: ['ApprenticeSolo.glb', 'Apprentice.glb'] },
      { key: 'yumi', files: ['Yumi.glb'] },
      { key: 'petico', files: ['Petico.glb'] },
      { key: 'house', files: ['House.glb'] },
      { key: 'world', files: ['World01.glb'] },        // v0.2: Vale dos Morangos (ao ar livre)
      { key: 'divonica', files: ['Divonica.glb'] },    // v0.2: NPC que entrega a varinha
      { key: 'minion', files: ['ShadowMinion.glb'] },  // v0.2: Sombrito
      { key: 'sprout', files: ['GuardianSprout.glb'] }, // v0.3: Broto Guardião (magia da horta)
    ];
    // ?placeholder=1 (ou =house,yumi,petico,apprentice) força os placeholders: útil para testar o fallback.
    const forced = new URLSearchParams(location.search).get('placeholder');
    const isForced = (key) => forced !== null && (forced === '' || forced === '1' || forced === 'all' || forced.split(',').includes(key));
    const progress = new Array(jobs.length + 1).fill(0);
    const report = () => onProgress(progress.reduce((a, b) => a + b, 0) / progress.length);

    const dataP = Promise.all([this._loadJSON('animations.json'), this._loadJSON('npcs.json')]).then(([d, n]) => {
      this.animData = { ...d, ...n };
      progress[jobs.length] = 1;
      report();
    });

    const modelPs = jobs.map(async (job, i) => {
      let loaded = null;
      let used = null;
      for (const file of isForced(job.key) ? [] : job.files) {
        loaded = await this._loadGLB(file, (p) => { progress[i] = p; report(); });
        if (loaded) { used = file; break; }
      }
      progress[i] = 1;
      report();
      this.models[job.key] = { ...(loaded ?? {}), source: used, placeholder: !loaded };
    });

    await Promise.all([dataP, ...modelPs]);
    this._finalize();
    onProgress(1);
    return this;
  }

  _finalize() {
    const m = this.models;
    const stem = (f) => (f ? f.replace(/\.glb$/i, '') : null);

    // --- Aprendiz
    {
      const a = m.apprentice;
      if (a.placeholder) {
        console.warn('[Assets] ApprenticeSolo.glb / Apprentice.glb ausentes: usando aprendiz placeholder.');
        const ph = buildPlaceholderApprentice();
        Object.assign(a, { scene: ph.scene, clips: new Map(), rig: ph.rig });
      } else if (a.source === 'Apprentice.glb') {
        console.warn('[Assets] ApprenticeSolo.glb ausente: usando Apprentice.glb sem os gatos.');
        a.scene.traverse((o) => { if (o.isMesh && /yumi|petico/i.test(o.name)) o.visible = false; });
      }
      Object.assign(a, this._charData(stem(a.source), 'ApprenticeSolo', 'Apprentice'));
    }

    // --- Gatos
    for (const [key, name, color] of [['yumi', 'Yumi', '#fffaf3'], ['petico', 'Petico', '#8e94a3']]) {
      const c = m[key];
      if (c.placeholder) {
        console.warn(`[Assets] ${name}.glb ausente: usando gato placeholder.`);
        const ph = buildPlaceholderCat(color);
        Object.assign(c, { scene: ph.scene, clips: new Map(), rig: ph.rig });
      }
      Object.assign(c, this._charData(name));
    }

    // --- v0.2: mundo externo, Divonica, Sombrito (sem placeholder: ficam ausentes se o arquivo faltar)
    for (const [key, name] of [['divonica', 'Divonica'], ['minion', 'ShadowMinion']]) {
      const c = m[key];
      if (!c.placeholder) Object.assign(c, this._charData(name));
      else console.warn(`[Assets] ${name}.glb ausente.`);
    }
    if (m.world.placeholder) console.warn('[Assets] World01.glb ausente: o mundo externo não estará disponível.');

    // --- Casa
    {
      const h = m.house;
      if (h.placeholder) {
        console.warn('[Assets] House.glb ausente: usando casa procedural.');
        Object.assign(h, { scene: buildPlaceholderHouse(), clips: new Map() });
      }
    }
  }
}
