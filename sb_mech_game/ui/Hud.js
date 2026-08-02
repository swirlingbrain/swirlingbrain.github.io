// Live-data HUD overlay. Builds its own DOM (no static markup — see the
// Concurrency rule in the Phase 1 plan: index.html/tests/test-runner.html are
// off-limits to every fan-out task group) and exposes createHud()/updateHud()
// per the Task Group D interface contract.
//
// Visual language follows the approved HUD mockup: cyan lines on dark cockpit
// glass panels, with green/amber/red used consistently for every "how bad is
// this stat" readout (armor, heat, target health) via HudMath's heatToColor.

import {
  worldToRadarPosition,
  heatToColor,
  distanceBetween,
  findNearestEnemy,
  computeHealthFraction,
} from './HudMath.js';
import { HEAT_SHUTDOWN_THRESHOLD, HEAT_MAX } from '../mech/MechConstants.js';
import { SENSOR_RANGE } from '../ai/AiConstants.js';

// Radar range now mirrors AI's actual sensor range directly (both task groups
// are merged into this worktree, so the dependency is safe) -- keeps the
// radar from visually showing/hiding targets at a range that diverges from
// what AI can actually detect/engage.
const RADAR_RANGE_UNITS = SENSOR_RANGE;
const RADAR_PIXEL_RADIUS = 64;
const RADAR_CANVAS_SIZE = 150;

const WEAPON_SLOT_COUNT = 4;

const ARMOR_LOCATIONS = [
  { key: 'head', label: 'HD' },
  { key: 'la', label: 'LA' },
  { key: 'lt', label: 'LT' },
  { key: 'ct', label: 'CT' },
  { key: 'rt', label: 'RT' },
  { key: 'ra', label: 'RA' },
  { key: 'll', label: 'LL' },
  { key: 'rl', label: 'RL' },
];

const STATUS_CLASSES = ['hud-good', 'hud-warn', 'hud-critical'];

function setStatusClass(el, category) {
  el.classList.remove(...STATUS_CLASSES);
  el.classList.add(`hud-${category}`);
}

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

function injectStyle() {
  if (document.getElementById('mech-hud-style')) return;
  const style = document.createElement('style');
  style.id = 'mech-hud-style';
  style.textContent = `
    .mech-hud-root {
      position: fixed;
      inset: 0;
      pointer-events: none;
      font-family: 'Consolas', 'Courier New', monospace;
      color: #7fe7ff;
      z-index: 5;
      --hud-cyan: #7fe7ff;
      --hud-bg: rgba(4, 20, 26, 0.55);
      --hud-border: rgba(127, 231, 255, 0.55);
      --hud-good: #3ddc71;
      --hud-warn: #ffb020;
      --hud-critical: #ff3b3b;
    }
    .mech-hud-panel {
      position: absolute;
      background: var(--hud-bg);
      border: 1px solid var(--hud-border);
      border-radius: 4px;
      padding: 8px 10px;
      box-shadow: 0 0 12px rgba(127, 231, 255, 0.12) inset;
    }
    .mech-hud-label {
      font-size: 10px;
      letter-spacing: 0.1em;
      opacity: 0.75;
      margin-bottom: 4px;
    }
    .mech-hud-radar { top: 16px; left: 16px; width: ${RADAR_CANVAS_SIZE}px; }
    .mech-hud-target { top: 16px; right: 16px; min-width: 170px; text-align: right; }
    .mech-hud-heat {
      top: 50%; right: 16px; transform: translateY(-50%);
      width: 34px; display: flex; flex-direction: column; align-items: center;
    }
    .mech-hud-armor { bottom: 16px; left: 50%; transform: translateX(-50%); }
    .mech-hud-weapons { bottom: 16px; right: 16px; min-width: 150px; }
    .mech-hud-throttle { bottom: 16px; left: 16px; width: 150px; }

    .mech-hud-target-name { font-size: 15px; font-weight: bold; }
    .mech-hud-target-range { font-size: 11px; opacity: 0.85; margin: 2px 0 6px; }
    .mech-hud-bar-track {
      width: 100%; height: 8px; background: rgba(127,231,255,0.12);
      border: 1px solid var(--hud-border); border-radius: 2px; overflow: hidden;
    }
    .mech-hud-bar-fill { height: 100%; width: 0%; background: var(--hud-good); transition: width 80ms linear; }
    .mech-hud-bar-fill.hud-good { background: var(--hud-good); }
    .mech-hud-bar-fill.hud-warn { background: var(--hud-warn); }
    .mech-hud-bar-fill.hud-critical { background: var(--hud-critical); }

    .mech-hud-heat-track {
      width: 14px; height: 140px; background: rgba(127,231,255,0.12);
      border: 1px solid var(--hud-border); border-radius: 3px;
      display: flex; align-items: flex-end; overflow: hidden; margin: 4px 0;
    }
    .mech-hud-heat-fill { width: 100%; height: 0%; background: var(--hud-good); transition: height 80ms linear; }
    .mech-hud-heat-fill.hud-good { background: var(--hud-good); }
    .mech-hud-heat-fill.hud-warn { background: var(--hud-warn); }
    .mech-hud-heat-fill.hud-critical { background: var(--hud-critical); }
    .mech-hud-heat-pct { font-size: 11px; margin-top: 2px; }
    .mech-hud-shutdown {
      font-size: 10px; color: var(--hud-critical); font-weight: bold;
      margin-top: 4px; opacity: 0; animation: mech-hud-blink 0.6s steps(1) infinite;
    }
    .mech-hud-shutdown.mech-hud-visible { opacity: 1; }
    @keyframes mech-hud-blink { 50% { opacity: 0.15; } }

    .mech-hud-armor-grid {
      display: grid;
      grid-template-columns: repeat(5, 30px);
      grid-template-rows: repeat(3, 22px);
      grid-template-areas:
        ".  .  head head ."
        "la lt ct   rt    ra"
        ".  ll ll   rl    rl";
      gap: 3px;
    }
    .mech-hud-armor-cell {
      display: flex; align-items: center; justify-content: center;
      font-size: 9px; border-radius: 2px;
      background: var(--hud-good); color: #041a1a; font-weight: bold;
    }
    .mech-hud-armor-cell.hud-good { background: var(--hud-good); }
    .mech-hud-armor-cell.hud-warn { background: var(--hud-warn); }
    .mech-hud-armor-cell.hud-critical { background: var(--hud-critical); }
    .mech-hud-armor-cell.mech-hud-destroyed { background: #333; color: #888; }

    .mech-hud-weapon-row {
      display: flex; justify-content: space-between; font-size: 11px;
      padding: 2px 0; border-bottom: 1px solid rgba(127,231,255,0.15);
    }
    .mech-hud-weapon-row:last-child { border-bottom: none; }
    .mech-hud-weapon-status.hud-good { color: var(--hud-good); }
    .mech-hud-weapon-status.hud-warn { color: var(--hud-warn); }
    .mech-hud-weapon-status.hud-critical { color: var(--hud-critical); }

    .mech-hud-throttle-readout { display: flex; justify-content: space-between; font-size: 11px; margin-top: 4px; }

    .mech-hud-reticle {
      position: absolute; top: 50%; left: 50%; width: 28px; height: 28px;
      transform: translate(-50%, -50%);
    }
    .mech-hud-reticle::before, .mech-hud-reticle::after {
      content: ''; position: absolute; background: var(--hud-cyan);
      box-shadow: 0 0 4px rgba(0,0,0,0.8);
    }
    .mech-hud-reticle::before { top: 50%; left: 0; right: 0; height: 2px; transform: translateY(-1px); }
    .mech-hud-reticle::after { left: 50%; top: 0; bottom: 0; width: 2px; transform: translateX(-1px); }
    .mech-hud-reticle.mech-hud-reticle-locked::before,
    .mech-hud-reticle.mech-hud-reticle-locked::after { background: var(--hud-critical); }
  `;
  document.head.appendChild(style);
}

/**
 * Creates the HUD's DOM tree and appends it to document.body. Pure-DOM setup,
 * no per-frame logic here — call updateHud(handle, ...) once per frame instead.
 */
export function createHud() {
  injectStyle();

  const container = el('div', 'mech-hud-root');
  document.body.appendChild(container);

  // --- Reticle (screen center) ---
  const reticleEl = el('div', 'mech-hud-reticle', container);

  // --- Radar (top-left) ---
  const radarPanel = el('div', 'mech-hud-panel mech-hud-radar', container);
  el('div', 'mech-hud-label', radarPanel).textContent = 'RADAR';
  const radarCanvas = el('canvas', null, radarPanel);
  radarCanvas.width = RADAR_CANVAS_SIZE - 20;
  radarCanvas.height = RADAR_CANVAS_SIZE - 20;
  const radarCtx = radarCanvas.getContext('2d');

  // --- Target info (top-right) ---
  const targetPanel = el('div', 'mech-hud-panel mech-hud-target', container);
  el('div', 'mech-hud-label', targetPanel).textContent = 'TARGET';
  const targetNameEl = el('div', 'mech-hud-target-name', targetPanel);
  const targetRangeEl = el('div', 'mech-hud-target-range', targetPanel);
  const targetHealthTrack = el('div', 'mech-hud-bar-track', targetPanel);
  const targetHealthFillEl = el('div', 'mech-hud-bar-fill', targetHealthTrack);

  // --- Heat gauge (right edge) ---
  const heatPanel = el('div', 'mech-hud-panel mech-hud-heat', container);
  el('div', 'mech-hud-label', heatPanel).textContent = 'HEAT';
  const heatTrack = el('div', 'mech-hud-heat-track', heatPanel);
  const heatFillEl = el('div', 'mech-hud-heat-fill', heatTrack);
  const heatPercentEl = el('div', 'mech-hud-heat-pct', heatPanel);
  const shutdownEl = el('div', 'mech-hud-shutdown', heatPanel);
  shutdownEl.textContent = 'SHUTDOWN';

  // --- Armor paperdoll (bottom-center) ---
  const armorPanel = el('div', 'mech-hud-panel mech-hud-armor', container);
  const armorGrid = el('div', 'mech-hud-armor-grid', armorPanel);
  const armorCells = {};
  for (const { key, label } of ARMOR_LOCATIONS) {
    const cell = el('div', 'mech-hud-armor-cell', armorGrid);
    cell.style.gridArea = key;
    cell.textContent = label;
    armorCells[key] = cell;
  }

  // --- Weapon groups (bottom-right) ---
  const weaponsPanel = el('div', 'mech-hud-panel mech-hud-weapons', container);
  el('div', 'mech-hud-label', weaponsPanel).textContent = 'WEAPONS';
  const weaponSlots = [];
  for (let i = 0; i < WEAPON_SLOT_COUNT; i += 1) {
    const row = el('div', 'mech-hud-weapon-row', weaponsPanel);
    const nameEl = el('span', null, row);
    const statusEl = el('span', 'mech-hud-weapon-status', row);
    weaponSlots.push({ row, nameEl, statusEl });
  }

  // --- Throttle/speed (bottom-left) ---
  const throttlePanel = el('div', 'mech-hud-panel mech-hud-throttle', container);
  el('div', 'mech-hud-label', throttlePanel).textContent = 'THROTTLE';
  const throttleTrack = el('div', 'mech-hud-bar-track', throttlePanel);
  const throttleFillEl = el('div', 'mech-hud-bar-fill hud-good', throttleTrack);
  const throttleReadout = el('div', 'mech-hud-throttle-readout', throttlePanel);
  const throttlePctEl = el('span', null, throttleReadout);
  const speedEl = el('span', null, throttleReadout);

  return {
    container,
    reticleEl,
    radarCanvas,
    radarCtx,
    targetNameEl,
    targetRangeEl,
    targetHealthFillEl,
    heatFillEl,
    heatPercentEl,
    shutdownEl,
    armorCells,
    weaponSlots,
    throttleFillEl,
    throttlePctEl,
    speedEl,
  };
}

function updateRadar(hudHandle, playerMech, world) {
  const { radarCtx, radarCanvas } = hudHandle;
  const size = radarCanvas.width;
  const center = size / 2;
  radarCtx.clearRect(0, 0, size, size);

  // Range rings.
  radarCtx.strokeStyle = 'rgba(127,231,255,0.25)';
  radarCtx.lineWidth = 1;
  for (const frac of [0.5, 1.0]) {
    radarCtx.beginPath();
    radarCtx.arc(center, center, RADAR_PIXEL_RADIUS * frac, 0, Math.PI * 2);
    radarCtx.stroke();
  }

  // Self marker.
  radarCtx.fillStyle = '#7fe7ff';
  radarCtx.beginPath();
  radarCtx.arc(center, center, 3, 0, Math.PI * 2);
  radarCtx.fill();

  for (const mech of world.mechs) {
    if (mech === playerMech || !mech.alive) continue;
    const pos = worldToRadarPosition(playerMech, mech, RADAR_RANGE_UNITS, RADAR_PIXEL_RADIUS);
    if (!pos) continue;
    radarCtx.fillStyle = mech.team === playerMech.team ? '#3ddc71' : '#ff3b3b';
    radarCtx.beginPath();
    radarCtx.arc(center + pos.x, center + pos.y, 3, 0, Math.PI * 2);
    radarCtx.fill();
  }
}

function updateTarget(hudHandle, playerMech, world) {
  const { targetNameEl, targetRangeEl, targetHealthFillEl } = hudHandle;

  let target = null;
  if (playerMech.currentTargetId) {
    target = world.mechs.find((m) => m.id === playerMech.currentTargetId && m.alive) || null;
  }
  let locked = !!target;
  if (!target) {
    target = findNearestEnemy(playerMech, world.mechs);
  }

  if (!target) {
    targetNameEl.textContent = 'NO TARGET';
    targetRangeEl.textContent = '';
    targetHealthFillEl.style.width = '0%';
    return;
  }

  const range = distanceBetween(playerMech.position, target.position);
  const healthFraction = computeHealthFraction(target);

  targetNameEl.textContent = `${locked ? 'LOCK' : 'TGT'} ${target.id}`;
  targetRangeEl.textContent = `${Math.round(range)}m`;
  targetHealthFillEl.style.width = `${Math.max(0, Math.min(1, healthFraction)) * 100}%`;
  setStatusClass(targetHealthFillEl, heatToColor(1 - healthFraction));
}

function updateHeat(hudHandle, playerMech) {
  const { heatFillEl, heatPercentEl, shutdownEl } = hudHandle;
  const heatFraction = playerMech.heat / HEAT_MAX;
  const dangerFraction = playerMech.heat / HEAT_SHUTDOWN_THRESHOLD;

  heatFillEl.style.height = `${Math.max(0, Math.min(1, heatFraction)) * 100}%`;
  setStatusClass(heatFillEl, heatToColor(dangerFraction));
  heatPercentEl.textContent = `${Math.round(heatFraction * 100)}%`;
  shutdownEl.classList.toggle('mech-hud-visible', !!playerMech.shutdown);
}

function updateArmor(hudHandle, playerMech) {
  const { armorCells } = hudHandle;
  for (const { key } of ARMOR_LOCATIONS) {
    const loc = playerMech.locations[key];
    const cell = armorCells[key];
    if (!loc || !cell) continue;
    if (loc.destroyed) {
      cell.classList.remove(...STATUS_CLASSES);
      cell.classList.add('mech-hud-destroyed');
      continue;
    }
    cell.classList.remove('mech-hud-destroyed');
    const armorFraction = loc.maxArmor > 0 ? loc.armor / loc.maxArmor : 0;
    setStatusClass(cell, heatToColor(1 - armorFraction));
  }
}

function weaponReadyCategory(weapon) {
  if (weapon.ammoRemaining === 0) return 'critical';
  if (weapon.cooldownRemaining > 0) return 'warn';
  return 'good';
}

function updateWeapons(hudHandle, playerMech) {
  const { weaponSlots } = hudHandle;
  const weapons = Array.isArray(playerMech.weapons) ? playerMech.weapons : [];

  for (let i = 0; i < weaponSlots.length; i += 1) {
    const { row, nameEl, statusEl } = weaponSlots[i];
    const weapon = weapons[i];
    if (!weapon) {
      row.style.display = i === 0 && weapons.length === 0 ? 'flex' : 'none';
      if (i === 0 && weapons.length === 0) {
        nameEl.textContent = '--';
        statusEl.textContent = '';
      }
      continue;
    }
    row.style.display = 'flex';
    nameEl.textContent = weapon.type.toUpperCase();
    const ammoText = Number.isFinite(weapon.ammoRemaining) ? `${Math.max(0, Math.round(weapon.ammoRemaining))}` : 'INF';
    const category = weaponReadyCategory(weapon);
    const statusText = category === 'good' ? 'READY' : category === 'warn' ? 'COOLING' : 'EMPTY';
    statusEl.textContent = `${ammoText} ${statusText}`;
    setStatusClass(statusEl, category);
  }
}

function updateThrottle(hudHandle, playerMech) {
  const { throttleFillEl, throttlePctEl, speedEl } = hudHandle;
  const throttleFraction = Math.max(-1, Math.min(1, playerMech.throttleInput || 0));
  throttleFillEl.style.width = `${Math.abs(throttleFraction) * 100}%`;
  throttlePctEl.textContent = `THR ${Math.round(throttleFraction * 100)}%`;
  speedEl.textContent = `${playerMech.speed.toFixed(1)} u/s`;
}

// currentTargetId is set every tick by main.js's own reticle hit-test (the
// same "nearest visible enemy within a tight facing cone" check that decides
// whether weapons fire), so coloring the reticle from it is always accurate
// to what firing the trigger right now would actually hit.
function updateReticle(hudHandle, playerMech) {
  hudHandle.reticleEl.classList.toggle('mech-hud-reticle-locked', !!playerMech.currentTargetId);
}

/**
 * Pushes current playerMech/world state into the HUD created by createHud().
 * Call once per rendered frame from Integration's main loop.
 */
export function updateHud(hudHandle, playerMech, world) {
  updateReticle(hudHandle, playerMech);
  updateRadar(hudHandle, playerMech, world);
  updateTarget(hudHandle, playerMech, world);
  updateHeat(hudHandle, playerMech);
  updateArmor(hudHandle, playerMech);
  updateWeapons(hudHandle, playerMech);
  updateThrottle(hudHandle, playerMech);
}
