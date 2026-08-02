import * as THREE from 'three';

// The playable/walkable map (world/Terrain.js) is capped to 200x200 units.
// Environment-fix note (Phase 0 carry-forward: "directional light doesn't
// follow the player, shadows vanish far from spawn"): rather than re-aiming
// the sun and re-fitting its shadow frustum every frame (option a in the
// plan), we take option (b) — the map is small enough that a single static
// shadow-camera frustum, sized once here to cover the whole terrain, keeps
// shadows correct everywhere on the map with no per-frame tracking needed.
const SHADOW_FRUSTUM_HALF_EXTENT = 110; // covers the full 200x200 terrain plus margin

// Sky/fog color kept identical so distant terrain fades seamlessly into the
// horizon instead of popping at the fog boundary.
const SKY_HORIZON_COLOR = 0x88aabb;
const SKY_ZENITH_COLOR = 0x4d6f8f;

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  return renderer;
}

export function createCamera() {
  return new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
}

/** Large inverted-sphere gradient sky, consistent with the existing sky-blue palette. */
export function createSky() {
  const geometry = new THREE.SphereGeometry(450, 32, 15);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      topColor: { value: new THREE.Color(SKY_ZENITH_COLOR) },
      bottomColor: { value: new THREE.Color(SKY_HORIZON_COLOR) },
      offset: { value: 20 },
      exponent: { value: 0.6 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + vec3(0.0, offset, 0.0)).y;
        gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  });
  const sky = new THREE.Mesh(geometry, material);
  sky.name = 'sky';
  return sky;
}

export function createSceneWithLighting() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_HORIZON_COLOR);
  // Fog fades the (now height-varied, ~140-unit-diagonal) terrain out before
  // it reaches the map edge, and its color matches the sky horizon so the
  // fade blends in rather than hard-clipping against a mismatched backdrop.
  scene.fog = new THREE.Fog(SKY_HORIZON_COLOR, 70, 190);
  scene.add(createSky());

  scene.add(new THREE.AmbientLight(0xffffff, 0.5));

  const sun = new THREE.DirectionalLight(0xffffff, 1.2);
  sun.position.set(50, 80, 30);
  sun.castShadow = true;
  sun.shadow.camera.left = -SHADOW_FRUSTUM_HALF_EXTENT;
  sun.shadow.camera.right = SHADOW_FRUSTUM_HALF_EXTENT;
  sun.shadow.camera.top = SHADOW_FRUSTUM_HALF_EXTENT;
  sun.shadow.camera.bottom = -SHADOW_FRUSTUM_HALF_EXTENT;
  sun.shadow.camera.far = 300;
  sun.shadow.mapSize.set(2048, 2048);
  scene.add(sun);

  return scene;
}

export function createGroundPlane(size = 500) {
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshStandardMaterial({ color: 0x3a5f3a }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  return ground;
}
