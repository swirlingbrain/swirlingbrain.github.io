// Procedurally-generated PBR-ish textures (diffuse/albedo + roughness), drawn
// via Canvas 2D at runtime -- no external image downloads. Real user
// playtesting called the game "blocky and crude"; the single biggest
// contributor was every material being metalness:0/roughness:1 (the flattest,
// least metallic setting MeshStandardMaterial supports), so nothing could
// ever read as metal regardless of lighting. This module generates a worn
// gunmetal panel look (base tint + panel seams + scratches + noise) plus a
// matching roughness map so different parts of the same surface catch
// light differently, which is what actually reads as "metal" rather than
// "painted plastic."

import * as THREE from 'three';

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function hexToRgb(hex) {
  return { r: (hex >> 16) & 255, g: (hex >> 8) & 255, b: hex & 255 };
}

function shade(rgb, factor) {
  return `rgb(${Math.max(0, Math.min(255, Math.round(rgb.r * factor)))}, ${Math.max(0, Math.min(255, Math.round(rgb.g * factor)))}, ${Math.max(0, Math.min(255, Math.round(rgb.b * factor)))})`;
}

/**
 * Draws a worn-metal-panel albedo texture in the given base color, with
 * randomized (but seeded/deterministic per chassis) panel seams and
 * scratches, and returns it as a THREE.CanvasTexture.
 */
export function createMetalAlbedoTexture(baseColorHex, seed = 1, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rgb = hexToRgb(baseColorHex);
  const rand = seededRandom(seed);

  ctx.fillStyle = shade(rgb, 1);
  ctx.fillRect(0, 0, size, size);

  // Subtle per-pixel-block noise for a brushed-metal grain (drawn as small
  // low-opacity rects rather than true per-pixel noise, much cheaper).
  for (let i = 0; i < size * 6; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const grain = 0.85 + rand() * 0.3;
    ctx.fillStyle = shade(rgb, grain);
    ctx.globalAlpha = 0.5;
    ctx.fillRect(x, y, 1 + rand() * 2, 1 + rand() * 2);
  }
  ctx.globalAlpha = 1;

  // Panel seams: a handful of darker rectangle outlines suggesting armor plates.
  const panelCount = 4 + Math.floor(rand() * 3);
  ctx.strokeStyle = shade(rgb, 0.45);
  ctx.lineWidth = Math.max(1, size / 128);
  for (let i = 0; i < panelCount; i += 1) {
    const w = size * (0.3 + rand() * 0.4);
    const h = size * (0.3 + rand() * 0.4);
    const x = rand() * (size - w);
    const y = rand() * (size - h);
    ctx.strokeRect(x, y, w, h);
  }

  // Scratches: short bright/dark streaks at varied angles.
  const scratchCount = 10 + Math.floor(rand() * 12);
  for (let i = 0; i < scratchCount; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const len = size * (0.05 + rand() * 0.12);
    const angle = rand() * Math.PI;
    const bright = rand() > 0.5;
    ctx.strokeStyle = shade(rgb, bright ? 1.5 : 0.35);
    ctx.globalAlpha = 0.35 + rand() * 0.3;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // A few rivets/bolts for silhouette-level detail up close.
  const rivetCount = 6 + Math.floor(rand() * 6);
  for (let i = 0; i < rivetCount; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * 0.008;
    const grad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    grad.addColorStop(0, shade(rgb, 1.6));
    grad.addColorStop(1, shade(rgb, 0.4));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Matching grayscale roughness map: mostly uniform mid-roughness with
 * scattered brighter (rougher/scuffed) and darker (worn-shiny) patches so the
 * surface doesn't reflect as a single uniform sheen.
 */
export function createMetalRoughnessTexture(seed = 1, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rand = seededRandom(seed + 9999);

  ctx.fillStyle = 'rgb(140,140,140)';
  ctx.fillRect(0, 0, size, size);

  const patchCount = 30 + Math.floor(rand() * 20);
  for (let i = 0; i < patchCount; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.02 + rand() * 0.06);
    const v = Math.round(60 + rand() * 160);
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Builds a ready-to-use MeshStandardMaterial with a real metallic response, given a base color and a seed (vary the seed per part so parts don't look identical). */
export function createMetalMaterial(baseColorHex, seed = 1) {
  return new THREE.MeshStandardMaterial({
    map: createMetalAlbedoTexture(baseColorHex, seed),
    roughnessMap: createMetalRoughnessTexture(seed),
    metalness: 0.75,
    roughness: 0.55,
  });
}

/**
 * Draws a mottled stone/rock albedo texture: blotchy mineral-variation
 * patches and irregular crack lines, rather than the metal texture's panel
 * seams/rivets (which read as unmistakably mechanical, wrong for natural
 * rock or crumbled masonry).
 */
export function createRockAlbedoTexture(baseColorHex, seed = 1, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const rgb = hexToRgb(baseColorHex);
  const rand = seededRandom(seed);

  ctx.fillStyle = shade(rgb, 1);
  ctx.fillRect(0, 0, size, size);

  // Soft-edged mineral-variation blotches.
  const blotchCount = 18 + Math.floor(rand() * 14);
  for (let i = 0; i < blotchCount; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const r = size * (0.06 + rand() * 0.16);
    const factor = 0.7 + rand() * 0.6;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, shade(rgb, factor));
    grad.addColorStop(1, shade(rgb, 1));
    ctx.fillStyle = grad;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Irregular jagged crack lines (multi-segment, unlike the metal texture's
  // straight scratches) suggesting fractured stone.
  const crackCount = 5 + Math.floor(rand() * 5);
  ctx.strokeStyle = shade(rgb, 0.35);
  for (let i = 0; i < crackCount; i += 1) {
    let x = rand() * size;
    let y = rand() * size;
    ctx.globalAlpha = 0.4 + rand() * 0.3;
    ctx.lineWidth = 1 + rand();
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segments = 3 + Math.floor(rand() * 4);
    for (let s = 0; s < segments; s += 1) {
      x += (rand() - 0.5) * size * 0.18;
      y += (rand() - 0.5) * size * 0.18;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Ready-to-use rock/masonry MeshStandardMaterial: low metalness, high roughness (unlike metal armor's 0.75/0.55). */
export function createRockMaterial(baseColorHex, seed = 1) {
  return new THREE.MeshStandardMaterial({
    map: createRockAlbedoTexture(baseColorHex, seed),
    roughnessMap: createMetalRoughnessTexture(seed),
    metalness: 0.05,
    roughness: 0.95,
  });
}
