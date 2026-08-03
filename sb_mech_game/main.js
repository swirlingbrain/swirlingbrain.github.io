import { GameLoop } from './core/GameLoop.js';
import { InputManager } from './core/InputManager.js';
import {
  createMech, applyThrottleInput, applyLegTurnInput, integrateMovement,
  applyLookYaw, applyLookPitch, decayHeat, updateHeatShutdown, applyDamage,
} from './mech/MechState.js';
import { LOOK_YAW_SENSITIVITY, LOOK_PITCH_SENSITIVITY, HEAT_SHUTDOWN_THRESHOLD } from './mech/MechConstants.js';
import { createRenderer, createCamera, createSceneWithLighting } from './render/SceneSetup.js';
import { createTerrain, getTerrainHeight, COVER_OBSTACLES } from './world/Terrain.js';
import { createPlaceholderMechMesh } from './render/MechMesh.js';
import { updateCameraFromMech } from './render/CameraRig.js';
import { createPostProcessing } from './render/PostProcessing.js';
import {
  updateLaserBeam, clearLaserBeam, spawnTracer, spawnImpactFlash, spawnExplosion, updateWeaponVfx,
} from './render/WeaponVFX.js';
import { createWorld, addMech } from './match/World.js';
import {
  createWeapon, tickCooldown, fireLaserTick, fireAutocannon, fireMissileVolley, updateMissileLock,
} from './weapons/WeaponState.js';
import { findVisibleEnemies } from './ai/Targeting.js';
import { decideAction } from './ai/Behavior.js';
import { RETREAT_HEAT_FRACTION } from './ai/AiConstants.js';
import { createHud, updateHud } from './ui/Hud.js';
import {
  createAudioManager, resumeAudioContext, updateListener,
  playWeaponFire, playImpact, playHeatWarning, playFootstep,
  playAmbientLoop, stopAmbientLoop,
} from './audio/AudioManager.js';

const canvas = document.getElementById('game-canvas');
const overlay = document.getElementById('start-overlay');

const renderer = createRenderer(canvas);
const camera = createCamera();
const scene = createSceneWithLighting();
scene.add(createTerrain());

const world = createWorld();

// Loadout design: every mech carries exactly 2 weapons (deliberately kept
// symmetric between teams -- an earlier pass gave the assault enemy 3
// weapons for extra hardpoints, which combined with instant/always-hit
// damage in this pass to make the enemy team unbeatable; heavier chassis
// still get their armor/speed edge from CHASSIS_DEFS without also stacking
// a firepower advantage). A single fire button fires every equipped weapon
// simultaneously (each independently gated by its own cooldown/ammo/heat)
// -- there's no weapon-group hotkey UI in this pass, a deliberate Phase 1
// simplification.
const TEAM_LOADOUTS = [
  { id: 'player', team: 'allies', chassisType: 'medium', weapons: ['laser', 'missile'] },
  { id: 'ally-1', team: 'allies', chassisType: 'light', weapons: ['laser', 'autocannon'] },
  { id: 'ally-2', team: 'allies', chassisType: 'medium', weapons: ['laser', 'missile'] },
  { id: 'ally-3', team: 'allies', chassisType: 'heavy', weapons: ['autocannon', 'missile'] },
  { id: 'enemy-1', team: 'enemies', chassisType: 'light', weapons: ['laser', 'autocannon'] },
  { id: 'enemy-2', team: 'enemies', chassisType: 'medium', weapons: ['laser', 'missile'] },
  { id: 'enemy-3', team: 'enemies', chassisType: 'heavy', weapons: ['autocannon', 'missile'] },
  { id: 'enemy-4', team: 'enemies', chassisType: 'assault', weapons: ['autocannon', 'missile'] },
];

// 85 keeps spawns comfortably inside the 200x200 terrain (+-100) and the
// +-110 shadow frustum, while making the ~170-unit lane separation wider than
// ai/AiConstants.js's ENGAGEMENT_RANGE (130) -- mechs have to actually close
// distance before anyone can fire, instead of spawning already in range.
const SPAWN_RADIUS = 85;
function spawnPositionFor(laneIndex, team) {
  const sideSign = team === 'allies' ? -1 : 1;
  const laneOffset = laneIndex * 14 - 21;
  return { x: sideSign * SPAWN_RADIUS, z: laneOffset };
}

const meshHandles = new Map();
const footstepDistance = new Map();
const laneIndexByTeam = { allies: 0, enemies: 0 };

for (const loadout of TEAM_LOADOUTS) {
  const mech = createMech(loadout.id, loadout.team, loadout.chassisType);
  const laneIndex = laneIndexByTeam[loadout.team]++;
  const spawn = spawnPositionFor(laneIndex, loadout.team);
  mech.position.x = spawn.x;
  mech.position.z = spawn.z;
  mech.position.y = getTerrainHeight(spawn.x, spawn.z);
  // Face each team toward the other side of the map at spawn.
  mech.legYaw = loadout.team === 'allies' ? -Math.PI / 2 : Math.PI / 2;
  mech.weapons = loadout.weapons.map((type) => createWeapon(type));
  mech.currentTargetId = null;
  addMech(world, mech);

  const meshHandle = createPlaceholderMechMesh(loadout.chassisType, loadout.team);
  scene.add(meshHandle.root);
  meshHandles.set(mech.id, meshHandle);
  footstepDistance.set(mech.id, 0);
}

const playerMech = world.mechs.find((m) => m.id === 'player');

const input = new InputManager(canvas, overlay);
const hud = createHud();

let audioManager = null;
overlay.addEventListener('click', () => {
  if (!audioManager) {
    audioManager = createAudioManager(playerMech);
    playAmbientLoop(audioManager);
  }
  resumeAudioContext(audioManager).catch(() => {});
  // The match (AI movement/combat/damage) does not begin until the player
  // actually clicks to start -- previously the GameLoop started unconditionally
  // at module load, so combat (including AI targeting/damaging the player's
  // own mech) was already running before the player had even seen the
  // controls or clicked, let alone pressed a key. loop.start() is idempotent
  // (a no-op if already running), so this is safe even if the overlay is
  // clicked again after a pointer-lock loss and reclick.
  loop.start();
  // Hide the overlay directly on click rather than relying solely on
  // InputManager's pointerlockchange handler. Pointer lock can fail to
  // engage for reasons unrelated to the player's intent (timing, browser
  // policy, focus state) -- when it does, pointerlockchange never fires and
  // the overlay was staying stuck on screen forever, blocking the entire
  // game behind an opaque panel even though the match was actually running.
  // InputManager's own listener still re-shows it if pointer lock is lost
  // mid-match (e.g. pressing Escape), which is the intended "click to
  // resume" behavior.
  overlay.style.display = 'none';
});

// Cheap circle-vs-circle collision against terrain props (rock cluster,
// ruined structure) -- a mech's plan-view footprint is approximated as a
// single radius rather than real mesh collision. Pushes the mech back out to
// the obstacle's boundary along the line between the two centers whenever it
// would otherwise overlap; called after integrateMovement for every mech
// every tick, so mechs can no longer walk straight through cover geometry.
const MECH_COLLISION_RADIUS = 1.5;
function resolveObstacleCollisions(mech) {
  for (const obstacle of COVER_OBSTACLES) {
    const dx = mech.position.x - obstacle.x;
    const dz = mech.position.z - obstacle.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const minDist = obstacle.radius + MECH_COLLISION_RADIUS;
    if (dist > 0.0001 && dist < minDist) {
      const push = (minDist - dist) / dist;
      mech.position.x += dx * push;
      mech.position.z += dz * push;
    }
  }
}

// Simplification (documented per plan Integration section): rather than real
// raycasting against 3D geometry, the player's "reticle" hit-test is the
// nearest visible enemy within a tight facing cone of the camera direction.
const PLAYER_FIRE_CONE_RADIANS = Math.PI / 18; // ~10 degrees

function angleBetween(fromPos, toPos) {
  const dx = toPos.x - fromPos.x;
  const dz = toPos.z - fromPos.z;
  return Math.atan2(-dx, -dz);
}

function normalizeAngle(angle) {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function pickPlayerTarget(mech, worldState) {
  const visible = findVisibleEnemies(mech, worldState.mechs);
  if (visible.length === 0) return null;
  const facing = mech.legYaw + mech.torsoYaw;
  let best = null;
  let bestAngle = Infinity;
  for (const enemy of visible) {
    const absDiff = Math.abs(normalizeAngle(angleBetween(mech.position, enemy.position) - facing));
    if (absDiff <= PLAYER_FIRE_CONE_RADIANS && absDiff < bestAngle) {
      bestAngle = absDiff;
      best = enemy;
    }
  }
  return best;
}

// Weighted hit-location table approximating real mech combat's center-mass
// bias (no real raycasting against body geometry in this Phase 1 pass).
const HIT_LOCATION_TABLE = [
  ['ct', 0.28], ['lt', 0.14], ['rt', 0.14], ['la', 0.11], ['ra', 0.11],
  ['ll', 0.10], ['rl', 0.10], ['head', 0.02],
];
function pickHitLocation() {
  let r = Math.random();
  for (const [key, weight] of HIT_LOCATION_TABLE) {
    if (r < weight) return key;
    r -= weight;
  }
  return 'ct';
}

// The laser is heat-limited only (no cooldown gate), so it "fires" every
// single tick it's held -- calling playWeaponFire every tick would trigger a
// fresh 0.35s envelope 60 times a second, which is exactly what produced the
// "deafening ringing" reported from real playtesting (dozens of overlapping
// near-identical tones per second). Throttle it to roughly once per envelope
// duration instead, per mech, so a sustained beam sounds like one sustained
// tone rather than a machine-gunned pile of near-simultaneous copies of it.
const LASER_SOUND_INTERVAL_SECONDS = 0.35;
const laserSoundCooldown = new Map();

// Deterministic per-mech pitch detune (+/- ~6%) so up to 8 mechs firing the
// identical laser tone at once don't reinforce into a single piercing pitch.
const pitchMultiplierByMechId = new Map();
function pitchMultiplierFor(mechId) {
  if (!pitchMultiplierByMechId.has(mechId)) {
    const hash = Array.from(mechId).reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
    pitchMultiplierByMechId.set(mechId, 0.94 + (hash % 13) * 0.01);
  }
  return pitchMultiplierByMechId.get(mechId);
}

function playLaserSoundThrottled(mechId, sourcePos, dt) {
  const remaining = (laserSoundCooldown.get(mechId) || 0) - dt;
  if (remaining <= 0) {
    if (audioManager) playWeaponFire(audioManager, 'laser', sourcePos, pitchMultiplierFor(mechId));
    laserSoundCooldown.set(mechId, LASER_SOUND_INTERVAL_SECONDS);
  } else {
    laserSoundCooldown.set(mechId, remaining);
  }
}

// Shared fire/cooldown/lock tick for both the player and every AI mech.
// Cooldown and missile-lock progress always tick (natural recovery/dwell);
// the actual fire attempt only happens if wantsToFire is true AND a target
// exists -- firing into empty space is skipped entirely rather than wasting
// ammo/heat, a deliberate simplification given there's no real projectile
// travel/miss simulation in this pass. Also drives the visible laser
// beam/tracer/impact-flash effects from render/WeaponVFX.js, since real user
// playtesting confirmed combat was unintelligible with zero visual feedback
// for what was being fired or at whom.
function tickMechWeapons(mech, target, wantsToFire, dt) {
  if (!mech.alive) return;
  const sourcePos = mech.position;
  const canFireNow = !mech.shutdown && wantsToFire && !!target && target.alive;

  for (const weapon of mech.weapons) {
    tickCooldown(weapon, dt);
    if (weapon.type === 'missile') {
      updateMissileLock(weapon, dt, !!target && wantsToFire);
    }

    if (weapon.type === 'laser') {
      if (canFireNow) {
        const damage = fireLaserTick(weapon, mech, dt);
        applyDamage(target, pickHitLocation(), damage);
        updateLaserBeam(scene, mech.id, sourcePos, target.position, true);
        playLaserSoundThrottled(mech.id, sourcePos, dt);
      } else {
        clearLaserBeam(scene, mech.id);
        laserSoundCooldown.delete(mech.id);
      }
      continue;
    }

    if (!canFireNow) continue;

    if (weapon.type === 'autocannon') {
      const result = fireAutocannon(weapon, mech);
      if (result) {
        applyDamage(target, pickHitLocation(), result.damage);
        spawnTracer(scene, sourcePos, target.position, 'autocannon');
        spawnImpactFlash(scene, target.position);
        if (audioManager) {
          playWeaponFire(audioManager, 'autocannon', sourcePos);
          playImpact(audioManager, target.position, result.damage);
        }
      }
    } else if (weapon.type === 'missile') {
      const result = fireMissileVolley(weapon, mech);
      if (result) {
        for (let i = 0; i < result.missileCount; i += 1) {
          applyDamage(target, pickHitLocation(), result.damagePerMissile);
        }
        spawnTracer(scene, sourcePos, target.position, 'missile', 0.25);
        spawnImpactFlash(scene, target.position, 1.5);
        if (audioManager) {
          playWeaponFire(audioManager, 'missile', sourcePos);
          playImpact(audioManager, target.position, result.damagePerMissile * result.missileCount);
        }
      }
    }
  }
}

// Destruction feedback: previously a destroyed mech's mesh just kept sitting
// there motionless, indistinguishable at a glance from an idle-but-alive one
// -- real playtesting reported "sometimes says defeat, sometimes victory...
// no mechs blow up or anything." Each mech gets exactly one explosion +
// mesh removal the instant mech.alive first goes false.
const deathHandled = new Set();
function handleMechDeaths() {
  for (const mech of world.mechs) {
    if (mech.alive || deathHandled.has(mech.id)) continue;
    deathHandled.add(mech.id);
    spawnExplosion(scene, mech.position);
    clearLaserBeam(scene, mech.id);
    const meshHandle = meshHandles.get(mech.id);
    if (meshHandle) meshHandle.root.visible = false;
  }
}

const FOOTSTEP_INTERVAL_UNITS = 2.5;
let playerWasAboveHeatWarning = false;
let matchOver = false;

function showMatchResult(text) {
  const resultOverlay = document.createElement('div');
  resultOverlay.style.cssText = `
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.75); color: #fff; font-family: sans-serif;
    font-size: 3rem; font-weight: bold; letter-spacing: 0.1em; z-index: 20;
  `;
  resultOverlay.textContent = text;
  document.body.appendChild(resultOverlay);
}

function checkWinCondition() {
  const alliesAlive = world.mechs.some((m) => m.team === 'allies' && m.alive);
  const enemiesAlive = world.mechs.some((m) => m.team === 'enemies' && m.alive);
  if (alliesAlive && enemiesAlive) return;
  matchOver = true;
  loop.stop();
  if (audioManager) stopAmbientLoop(audioManager);
  showMatchResult(alliesAlive ? 'VICTORY' : 'DEFEAT');
}

// Player death feedback: previously, once playerMech.alive went false, all
// input was silently ignored for the rest of the match with zero indication
// why -- keys would just stop doing anything. This shows a persistent
// "YOU WERE DESTROYED" banner the moment it happens (edge-triggered so it
// only fires once), separate from the full match-result overlay which only
// appears later once the whole team is eliminated.
let playerDeathMessageShown = false;
function checkPlayerDeathFeedback() {
  if (playerDeathMessageShown || playerMech.alive) return;
  playerDeathMessageShown = true;
  const deathBanner = document.createElement('div');
  deathBanner.style.cssText = `
    position: fixed; top: 24px; left: 50%; transform: translateX(-50%);
    color: #ff5b4a; font-family: sans-serif; font-size: 1.5rem; font-weight: bold;
    letter-spacing: 0.08em; text-shadow: 0 0 10px rgba(0,0,0,0.9); z-index: 15;
    pointer-events: none;
  `;
  deathBanner.textContent = 'YOUR MECH WAS DESTROYED -- watching the rest of the fight';
  document.body.appendChild(deathBanner);
}

const postProcessing = await createPostProcessing(renderer, scene, camera);

const loop = new GameLoop((dt) => {
  if (matchOver) return;

  if (playerMech.alive) {
    const { throttleInput, legTurnInput } = input.getMovementInputs();
    applyThrottleInput(playerMech, throttleInput, dt);
    applyLegTurnInput(playerMech, legTurnInput, dt);
    integrateMovement(playerMech, dt);
    resolveObstacleCollisions(playerMech);

    const look = input.consumeLookDelta();
    applyLookYaw(playerMech, -look.x * LOOK_YAW_SENSITIVITY);
    applyLookPitch(playerMech, -look.y * LOOK_PITCH_SENSITIVITY);

    decayHeat(playerMech, dt);
    updateHeatShutdown(playerMech);

    const playerTarget = pickPlayerTarget(playerMech, world);
    playerMech.currentTargetId = playerTarget ? playerTarget.id : null;
    tickMechWeapons(playerMech, playerTarget, input.isFireHeld(), dt);
  }

  for (const mech of world.mechs) {
    if (mech.id === 'player' || !mech.alive) continue;
    const decision = decideAction(mech, world, dt);
    applyThrottleInput(mech, decision.throttleInput, dt);
    applyLegTurnInput(mech, decision.legTurnInput, dt);
    integrateMovement(mech, dt);
    resolveObstacleCollisions(mech);
    applyLookYaw(mech, decision.lookYawDelta);
    applyLookPitch(mech, decision.lookPitchDelta);
    decayHeat(mech, dt);
    updateHeatShutdown(mech);
    mech.currentTargetId = decision.targetId;
    const target = decision.targetId ? world.mechs.find((m) => m.id === decision.targetId) : null;
    tickMechWeapons(mech, target, decision.wantsToFire, dt);
  }

  for (const mech of world.mechs) {
    if (!mech.alive) continue;
    mech.position.y = getTerrainHeight(mech.position.x, mech.position.z);

    const traveled = footstepDistance.get(mech.id) + mech.speed * dt;
    if (traveled >= FOOTSTEP_INTERVAL_UNITS) {
      footstepDistance.set(mech.id, 0);
      if (audioManager) playFootstep(audioManager, mech.position);
    } else {
      footstepDistance.set(mech.id, traveled);
    }

    const meshHandle = meshHandles.get(mech.id);
    if (mech.id === 'player') {
      updateCameraFromMech(camera, mech, meshHandle);
    } else {
      meshHandle.root.position.set(mech.position.x, mech.position.y, mech.position.z);
      meshHandle.root.rotation.y = mech.legYaw;
      meshHandle.torsoGroup.rotation.y = mech.torsoYaw;
    }
  }

  const isAboveHeatWarning = playerMech.heat > HEAT_SHUTDOWN_THRESHOLD * RETREAT_HEAT_FRACTION;
  if (isAboveHeatWarning && !playerWasAboveHeatWarning && audioManager) {
    playHeatWarning(audioManager);
  }
  playerWasAboveHeatWarning = isAboveHeatWarning;

  if (audioManager) updateListener(audioManager, playerMech);
  updateHud(hud, playerMech, world);

  handleMechDeaths();
  updateWeaponVfx(scene, dt);

  checkPlayerDeathFeedback();
  checkWinCondition();

  postProcessing.render(dt);
});

// loop.start() is called from the overlay click handler above, not here --
// see that handler's comment for why.

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  postProcessing.setSize(window.innerWidth, window.innerHeight);
});
