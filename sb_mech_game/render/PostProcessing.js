// render/PostProcessing.js
//
// Task Group G — Post-Processing / Render Polish.
//
// Builds a pmndrs/postprocessing composer with bloom, SSAO, ACES filmic tone
// mapping, vignette, and chromatic aberration. Loaded via a runtime dynamic
// import (not a static ES-module import) specifically so that a CDN failure
// (network hiccup, version 404, ad-blocker, etc.) can be caught and handled
// gracefully instead of taking down the whole module graph — a static
// `import ... from 'postprocessing'` failing would throw at parse/link time
// before any of our own code even runs.
//
// Interface contract (per plan Task Group G):
//   createPostProcessing(renderer, scene, camera) -> Promise<handle>
//   handle.render(dt)               // call this INSTEAD of renderer.render(scene, camera)
//   handle.setSize(width, height)   // call this INSTEAD of / in addition to renderer.setSize
//                                    // on window resize (keeps composer buffers in sync;
//                                    // it internally resizes the renderer too)
//   handle.usingFallback            // true if postprocessing failed to load / init and we
//                                    // dropped back to plain renderer.render(scene, camera)
//
// NOTE for Integration (main.js, done later in a separate sequential step):
// `createPostProcessing` is ASYNC (the dynamic import is a Promise). Integration
// must `await` it (or `.then()`) before starting the render loop, e.g.:
//
//   const postProcessing = await createPostProcessing(renderer, scene, camera);
//   const loop = new GameLoop((dt) => {
//     // ...update mechs, camera, etc...
//     postProcessing.render(dt);   // replaces renderer.render(scene, camera)
//   });
//   loop.start();
//   window.addEventListener('resize', () => {
//     camera.aspect = window.innerWidth / window.innerHeight;
//     camera.updateProjectionMatrix();
//     postProcessing.setSize(window.innerWidth, window.innerHeight);
//   });

import * as THREE from 'three';

// Tuned so bloom picks up the sky/sun highlight and any future emissive
// elements (muzzle flashes, etc. from Task Groups A/C) without the whole
// scene glowing. See plan acceptance criteria: bloom must be visible even
// before any emissive gameplay elements exist.
const BLOOM_LUMINANCE_THRESHOLD = 0.65;
const BLOOM_LUMINANCE_SMOOTHING = 0.15;
const BLOOM_INTENSITY = 1.4;
const BLOOM_MIPMAP_RADIUS = 0.7;
const BLOOM_MIPMAP_LEVELS = 6;

const SSAO_RADIUS = 0.2;
const SSAO_INTENSITY = 1.5;
const SSAO_LUMINANCE_INFLUENCE = 0.6;
const SSAO_SAMPLES = 9;
const SSAO_RINGS = 7;

// "Subtle" per the plan's explicit guidance to err toward less intense than
// a first instinct.
const VIGNETTE_OFFSET = 0.35;
const VIGNETTE_DARKNESS = 0.45;
const CHROMATIC_ABERRATION_OFFSET = 0.0009;

/**
 * Builds a plain-renderer fallback handle. Used both when the postprocessing
 * import fails outright and when composer construction throws for any other
 * reason (e.g. WebGL2 unavailable for a required feature).
 */
function createFallbackHandle(renderer, scene, camera) {
  return {
    usingFallback: true,
    render(_dt) {
      renderer.render(scene, camera);
    },
    setSize(width, height) {
      renderer.setSize(width, height);
    },
    dispose() {},
  };
}

/**
 * Creates the post-processing pipeline. Always resolves (never rejects) —
 * on any failure it logs a console warning and resolves to a fallback handle
 * that just calls renderer.render(scene, camera) directly, so a CDN hiccup
 * degrades render quality instead of breaking the game.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @returns {Promise<{usingFallback: boolean, render(dt:number):void, setSize(w:number,h:number):void, dispose():void}>}
 */
export async function createPostProcessing(renderer, scene, camera) {
  let pp;
  try {
    // Dynamic import: resolved against the "postprocessing" entry added to
    // index.html's import map. If that CDN entry 404s or the network fails,
    // this rejects and we fall back below instead of crashing module load.
    pp = await import('postprocessing');
  } catch (err) {
    console.warn(
      '[PostProcessing] Failed to load "postprocessing" from CDN — falling back to plain renderer.render(). ' +
        'Bloom/SSAO/tone mapping/vignette will be unavailable this session.',
      err,
    );
    // Still apply Three.js's own native tone mapping (unrelated to whether the
    // "postprocessing" package loaded) so the more likely failure mode (a CDN
    // hiccup) degrades to a strictly better-looking fallback than flat linear output.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    return createFallbackHandle(renderer, scene, camera);
  }

  // Declared outside the try block so the catch handler can dispose of any
  // partially-constructed composer (and its allocated render targets) rather
  // than leaking them for the rest of the page session if a later step throws.
  let composer;
  try {
    const {
      EffectComposer,
      RenderPass,
      NormalPass,
      EffectPass,
      BloomEffect,
      SSAOEffect,
      ToneMappingEffect,
      ToneMappingMode,
      VignetteEffect,
      ChromaticAberrationEffect,
    } = pp;

    // The library's ToneMappingEffect does the tone mapping itself as part of
    // the composited shader chain; leaving the renderer's own tone mapping on
    // as well would double-apply it, so we explicitly disable it here.
    renderer.toneMapping = THREE.NoToneMapping;

    composer = new EffectComposer(renderer);

    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // SSAO needs a scene-normals buffer to estimate contact occlusion.
    const normalPass = new NormalPass(scene, camera);
    composer.addPass(normalPass);

    const ssaoEffect = new SSAOEffect(camera, normalPass.texture, {
      samples: SSAO_SAMPLES,
      rings: SSAO_RINGS,
      radius: SSAO_RADIUS,
      intensity: SSAO_INTENSITY,
      luminanceInfluence: SSAO_LUMINANCE_INFLUENCE,
    });

    const bloomEffect = new BloomEffect({
      luminanceThreshold: BLOOM_LUMINANCE_THRESHOLD,
      luminanceSmoothing: BLOOM_LUMINANCE_SMOOTHING,
      intensity: BLOOM_INTENSITY,
      // Mip-chain blur: gives a soft, wide glow that reads clearly against
      // the sky/sun highlight and muzzle flashes without a full-resolution
      // blur pass — cheaper than it looks, since it operates on downsampled
      // mips. If a slow device is later found to struggle, this is the first
      // knob to turn off per the plan's "scale back SSAO first" guidance,
      // then this one.
      mipmapBlur: true,
      radius: BLOOM_MIPMAP_RADIUS,
      levels: BLOOM_MIPMAP_LEVELS,
    });

    const toneMappingEffect = new ToneMappingEffect({
      mode: ToneMappingMode.ACES_FILMIC,
    });

    const vignetteEffect = new VignetteEffect({
      offset: VIGNETTE_OFFSET,
      darkness: VIGNETTE_DARKNESS,
    });

    const chromaticAberrationEffect = new ChromaticAberrationEffect({
      offset: new THREE.Vector2(CHROMATIC_ABERRATION_OFFSET, CHROMATIC_ABERRATION_OFFSET),
    });

    // A single EffectPass merges these into one shader for performance
    // (rather than one full-screen pass per effect). SSAO is listed first so
    // it darkens contact areas before bloom/tone mapping/vignette/chromatic
    // aberration act on the resulting color.
    const effectPass = new EffectPass(
      camera,
      ssaoEffect,
      bloomEffect,
      toneMappingEffect,
      vignetteEffect,
      chromaticAberrationEffect,
    );
    composer.addPass(effectPass);

    const size = renderer.getSize(new THREE.Vector2());
    composer.setSize(size.x, size.y);

    return {
      usingFallback: false,
      render(dt) {
        composer.render(dt);
      },
      setSize(width, height) {
        composer.setSize(width, height);
      },
      dispose() {
        composer.dispose();
      },
    };
  } catch (err) {
    console.warn(
      '[PostProcessing] "postprocessing" loaded but the pipeline failed to initialize — falling back to plain renderer.render().',
      err,
    );
    // The composer may have allocated render targets/framebuffers before the
    // step that threw -- dispose them so they don't leak for the rest of the
    // page session.
    if (composer) {
      composer.dispose();
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    return createFallbackHandle(renderer, scene, camera);
  }
}
