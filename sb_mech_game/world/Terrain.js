import * as THREE from 'three';
import {
  TERRAIN_SIZE, HEIGHT_SCALE, COVER_OBSTACLES, getTerrainHeight, smoothNoise,
} from './TerrainConstants.js';

// Re-exported for backward compatibility -- callers that only need the pure
// data/math (e.g. ai/Behavior.js's cover-seeking) should import directly from
// ./TerrainConstants.js instead, to avoid pulling in a 'three' dependency.
export { TERRAIN_SIZE, COVER_OBSTACLES, getTerrainHeight };

const TERRAIN_SEGMENTS = 96;

function buildGroundMesh() {
  const geometry = new THREE.PlaneGeometry(
    TERRAIN_SIZE,
    TERRAIN_SIZE,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS,
  );
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const grass = new THREE.Color(0x3a5f3a);
  const dirt = new THREE.Color(0x5c4a34);
  const rock = new THREE.Color(0x736f66);
  const tmp = new THREE.Color();

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const h = getTerrainHeight(x, z);
    position.setY(i, h);

    const t = THREE.MathUtils.clamp(h / HEIGHT_SCALE, -1, 1);
    if (t < 0.15) {
      tmp.copy(grass);
    } else if (t < 0.55) {
      tmp.copy(grass).lerp(dirt, (t - 0.15) / 0.4);
    } else {
      tmp.copy(dirt).lerp(rock, (t - 0.55) / 0.45);
    }
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

/** A jagged rock-formation cluster (ridge) offering physical cover. */
function buildRockCluster(centerX, centerZ, count = 8) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0x6e6a60,
    roughness: 1,
    flatShading: true,
  });

  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const radius = 3 + smoothNoise(i * 3.1, centerX) * 9;
    const x = centerX + Math.cos(angle) * radius;
    const z = centerZ + Math.sin(angle) * radius;
    const scale = 1.5 + smoothNoise(i * 1.7, centerZ) * 3.5;

    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(scale, 0), material);
    rock.position.set(x, getTerrainHeight(x, z) + scale * 0.4, z);
    rock.rotation.set(
      smoothNoise(x, z) * Math.PI,
      smoothNoise(z, x) * Math.PI,
      smoothNoise(x + z, x - z) * Math.PI,
    );
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  }

  return group;
}

/** A small cluster of broken walls/pillars suggesting a ruined structure. */
function buildRuinedStructure(centerX, centerZ) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x8a8377, roughness: 0.95 });

  const wallDefs = [
    { w: 8, h: 4, d: 1, x: -4, z: -4, ry: 0.05 },
    { w: 1, h: 2.8, d: 8, x: -4, z: 0, ry: -0.1 },
    { w: 6, h: 2, d: 1, x: 2, z: 4, ry: 0.3 },
    { w: 1, h: 5, d: 1, x: 4, z: -3, ry: 0 },
  ];

  for (const def of wallDefs) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(def.w, def.h, def.d), material);
    const x = centerX + def.x;
    const z = centerZ + def.z;
    mesh.position.set(x, getTerrainHeight(x, z) + def.h / 2, z);
    mesh.rotation.y = def.ry;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Scattered rubble around the structure.
  for (let i = 0; i < 10; i += 1) {
    const x = centerX + (smoothNoise(i * 5.3, 0.7) - 0.5) * 16;
    const z = centerZ + (smoothNoise(0.7, i * 5.3) - 0.5) * 16;
    const s = 0.4 + smoothNoise(i, i * 2) * 0.8;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), material);
    mesh.position.set(x, getTerrainHeight(x, z) + s / 2, z);
    mesh.rotation.set(
      smoothNoise(i, 1) * Math.PI,
      smoothNoise(i, 2) * Math.PI,
      smoothNoise(i, 3) * Math.PI,
    );
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  return group;
}

/**
 * Builds the full environment: heightmapped ground with grass/dirt/rock
 * vertex-color shading, a rock-formation ridge, and a ruined structure —
 * everything Integration needs to add the map to the scene in one call.
 */
export function createTerrain() {
  const group = new THREE.Group();
  group.name = 'terrain';
  group.add(buildGroundMesh());
  group.add(buildRockCluster(COVER_OBSTACLES[0].x, COVER_OBSTACLES[0].z));
  group.add(buildRuinedStructure(COVER_OBSTACLES[1].x, COVER_OBSTACLES[1].z));
  return group;
}
