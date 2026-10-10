import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RENDER } from './config.js';

/**
 * Cena (HDR linear, MSAA) -> bloom com limiar alto (só o que é emissivo brilha) -> tone mapping + sRGB.
 * O tone mapping do renderer é aplicado pelo OutputPass (renderizar em render target não aplica).
 */
export class Postfx {
  constructor(renderer, scene, camera) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(renderer.getPixelRatio());
    this.renderPass = new RenderPass(scene, camera);
    const { strength, radius, threshold } = RENDER.bloom;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), strength, radius, threshold);
    this.output = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
  }

  /** width/height em pixels CSS. */
  setSize(width, height) {
    this.composer.setPixelRatio(this.composer.renderer.getPixelRatio());
    this.composer.setSize(width, height);
  }

  render(dt) {
    this.composer.render(dt);
  }
}
