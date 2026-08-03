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
const ROSTER_SLOT_COUNT = 4;

// Front-view humanoid/mech silhouette (head on top, torso with distinct
// left/center/right sections, arms hanging at the sides, legs at the
// bottom) drawn as SVG rects in a 0-120 x 0-134 viewBox. Real playtesting
// asked for the armor display to be "more humanoid shaped" so it's easy to
// tell which part has damage at a glance -- the previous version used a
// uniform grid of same-sized squares, which read as a spreadsheet rather
// than a body.
const PAPERDOLL_PARTS = [
  { key: 'head', label: 'HD', x: 50, y: 0, w: 20, h: 18 },
  { key: 'la', label: 'LA', x: 2, y: 24, w: 20, h: 56 },
  { key: 'lt', label: 'LT', x: 25, y: 20, w: 21, h: 48 },
  { key: 'ct', label: 'CT', x: 47.5, y: 18, w: 25, h: 52 },
  { key: 'rt', label: 'RT', x: 74, y: 20, w: 21, h: 48 },
  { key: 'ra', label: 'RA', x: 98, y: 24, w: 20, h: 56 },
  { key: 'll', label: 'LL', x: 34, y: 70, w: 24, h: 62 },
  { key: 'rl', label: 'RL', x: 62, y: 70, w: 24, h: 62 },
];

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Builds one humanoid paperdoll SVG inside `parent`. Returns {key: <rect>} for updateArmorCells(). */
function buildArmorPaperdoll(parent, extraClassName) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 134');
  svg.setAttribute('class', `mech-hud-paperdoll${extraClassName ? ` ${extraClassName}` : ''}`);
  const cells = {};
  for (const part of PAPERDOLL_PARTS) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', part.x);
    rect.setAttribute('y', part.y);
    rect.setAttribute('width', part.w);
    rect.setAttribute('height', part.h);
    rect.setAttribute('rx', 3);
    rect.setAttribute('class', 'mech-hud-paperdoll-part hud-good');
    svg.appendChild(rect);

    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', part.x + part.w / 2);
    text.setAttribute('y', part.y + part.h / 2 + 3);
    text.setAttribute('class', 'mech-hud-paperdoll-label');
    text.textContent = part.label;
    svg.appendChild(text);

    cells[part.key] = rect;
  }
  parent.appendChild(svg);
  return cells;
}

/** Colors each paperdoll part by the given mech's actual per-location armor. Shared by the player's own paperdoll and the target's mini paperdoll. */
function updateArmorCells(cells, mech) {
  for (const { key } of PAPERDOLL_PARTS) {
    const loc = mech.locations[key];
    const cell = cells[key];
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

/** 'enemy-2' -> 'E2', 'ally-1' -> 'A1' -- compact enough for the roster list. */
function abbreviateMechId(id) {
  const match = /^([a-zA-Z]+)-?(\d+)?$/.exec(id);
  if (!match) return id.slice(0, 4).toUpperCase();
  const prefix = match[1][0].toUpperCase();
  return match[2] ? `${prefix}${match[2]}` : match[1].slice(0, 4).toUpperCase();
}

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
    .mech-hud-roster { top: ${16 + RADAR_CANVAS_SIZE + 12}px; left: 16px; width: ${RADAR_CANVAS_SIZE}px; }
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

    .mech-hud-paperdoll {
      display: block; width: 92px; height: 103px; margin: 2px auto 4px;
      overflow: visible;
    }
    .mech-hud-paperdoll.mech-hud-paperdoll-small {
      width: 54px; height: 60px; margin: 6px 0 6px auto;
    }
    .mech-hud-paperdoll-part {
      fill: var(--hud-good); stroke: rgba(4,20,26,0.7); stroke-width: 2;
      transition: fill 120ms linear;
    }
    .mech-hud-paperdoll-part.hud-good { fill: var(--hud-good); }
    .mech-hud-paperdoll-part.hud-warn { fill: var(--hud-warn); }
    .mech-hud-paperdoll-part.hud-critical { fill: var(--hud-critical); }
    .mech-hud-paperdoll-part.mech-hud-destroyed { fill: #333; }
    .mech-hud-paperdoll-label {
      font-size: 9px; font-family: 'Consolas', 'Courier New', monospace;
      font-weight: bold; fill: #041a1a; text-anchor: middle; pointer-events: none;
    }
    .mech-hud-paperdoll-small .mech-hud-paperdoll-label { font-size: 11px; }

    .mech-hud-roster-row {
      display: flex; align-items: center; gap: 6px; margin-bottom: 4px;
      padding: 2px; border-radius: 2px; border: 1px solid transparent;
    }
    .mech-hud-roster-row.mech-hud-roster-locked {
      border-color: var(--hud-critical);
      box-shadow: 0 0 6px rgba(255, 59, 59, 0.5);
    }
    .mech-hud-roster-label { font-size: 10px; width: 24px; text-align: left; opacity: 0.85; }
    .mech-hud-roster-track {
      flex: 1; height: 6px; background: rgba(127,231,255,0.12);
      border: 1px solid var(--hud-border); border-radius: 2px; overflow: hidden;
    }
    .mech-hud-roster-fill { height: 100%; width: 0%; background: var(--hud-good); transition: width 80ms linear; }
    .mech-hud-roster-fill.hud-good { background: var(--hud-good); }
    .mech-hud-roster-fill.hud-warn { background: var(--hud-warn); }
    .mech-hud-roster-fill.hud-critical { background: var(--hud-critical); }

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

  // --- Enemy roster (left edge, below radar): every enemy's overall status
  // at a glance, labeled by id and highlighting whichever one is currently
  // locked -- real playtesting: "it would be nice to have something on the
  // hud that shows the status of each enemy mech," and "hard to know which
  // [bar] applies to" which mech. Kept as its own panel on the left (instead
  // of packed into TARGET on the right) so the right column doesn't grow
  // tall enough to collide with the heat gauge below it.
  const rosterPanel = el('div', 'mech-hud-panel mech-hud-roster', container);
  el('div', 'mech-hud-label', rosterPanel).textContent = 'ENEMIES';
  const rosterRows = [];
  for (let i = 0; i < ROSTER_SLOT_COUNT; i += 1) {
    const row = el('div', 'mech-hud-roster-row', rosterPanel);
    const labelEl = el('span', 'mech-hud-roster-label', row);
    const track = el('div', 'mech-hud-roster-track', row);
    const fillEl = el('div', 'mech-hud-roster-fill', track);
    rosterRows.push({ row, labelEl, fillEl });
  }

  // --- Target info (top-right): locked/nearest enemy's name+range+health,
  // plus a mini paperdoll of THAT enemy's per-location damage (real
  // playtesting: "hard to know which part of the enemy mech has damage").
  const targetPanel = el('div', 'mech-hud-panel mech-hud-target', container);
  el('div', 'mech-hud-label', targetPanel).textContent = 'TARGET';
  const targetNameEl = el('div', 'mech-hud-target-name', targetPanel);
  const targetRangeEl = el('div', 'mech-hud-target-range', targetPanel);
  const targetHealthTrack = el('div', 'mech-hud-bar-track', targetPanel);
  const targetHealthFillEl = el('div', 'mech-hud-bar-fill', targetHealthTrack);
  const targetPaperdollCells = buildArmorPaperdoll(targetPanel, 'mech-hud-paperdoll-small');

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
  const armorCells = buildArmorPaperdoll(armorPanel);

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
    targetPaperdollCells,
    rosterRows,
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
  const {
    targetNameEl, targetRangeEl, targetHealthFillEl, targetPaperdollCells,
  } = hudHandle;

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
    for (const { key } of PAPERDOLL_PARTS) {
      const cell = targetPaperdollCells[key];
      cell.classList.remove('mech-hud-destroyed');
      setStatusClass(cell, 'good');
    }
    return null;
  }

  const range = distanceBetween(playerMech.position, target.position);
  const healthFraction = computeHealthFraction(target);

  targetNameEl.textContent = `${locked ? 'LOCK' : 'TGT'} ${target.id}`;
  targetRangeEl.textContent = `${Math.round(range)}m`;
  targetHealthFillEl.style.width = `${Math.max(0, Math.min(1, healthFraction)) * 100}%`;
  setStatusClass(targetHealthFillEl, heatToColor(1 - healthFraction));
  updateArmorCells(targetPaperdollCells, target);
  return target;
}

// Shows every currently-alive enemy's overall health, not just the locked
// one -- real playtesting: "it would be nice to have something on the hud
// that shows the status of each enemy mech." Mirrors updateRadar's own
// enemy list/team-color logic (position awareness is already unconditional
// there regardless of cover) so this stays consistent with what the radar
// already reveals rather than adding a new, different visibility rule.
function updateRoster(hudHandle, playerMech, world, lockedTargetId) {
  const { rosterRows } = hudHandle;
  const enemies = world.mechs.filter((m) => m.team !== playerMech.team && m.alive);

  for (let i = 0; i < rosterRows.length; i += 1) {
    const { row, labelEl, fillEl } = rosterRows[i];
    const enemy = enemies[i];
    if (!enemy) {
      row.style.display = 'none';
      continue;
    }
    row.style.display = 'flex';
    row.classList.toggle('mech-hud-roster-locked', enemy.id === lockedTargetId);
    labelEl.textContent = abbreviateMechId(enemy.id);
    const healthFraction = computeHealthFraction(enemy);
    fillEl.style.width = `${Math.max(0, Math.min(1, healthFraction)) * 100}%`;
    setStatusClass(fillEl, heatToColor(1 - healthFraction));
  }
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
  updateArmorCells(hudHandle.armorCells, playerMech);
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
  const target = updateTarget(hudHandle, playerMech, world);
  updateRoster(hudHandle, playerMech, world, target ? target.id : null);
  updateHeat(hudHandle, playerMech);
  updateArmor(hudHandle, playerMech);
  updateWeapons(hudHandle, playerMech);
  updateThrottle(hudHandle, playerMech);
}
