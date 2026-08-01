import { GameLoop } from './core/GameLoop.js';
import { InputManager } from './core/InputManager.js';
import {
  createMech, applyThrottleInput, applyLegTurnInput, integrateMovement,
  applyLookYaw, applyLookPitch, decayHeat,
} from './mech/MechState.js';
import { LOOK_YAW_SENSITIVITY, LOOK_PITCH_SENSITIVITY } from './mech/MechConstants.js';
import {
  createRenderer, createCamera, createSceneWithLighting, createGroundPlane,
} from './render/SceneSetup.js';
import { createPlaceholderMechMesh } from './render/MechMesh.js';
import { updateCameraFromMech } from './render/CameraRig.js';
import { createWorld, addMech } from './match/World.js';

const canvas = document.getElementById('game-canvas');
const overlay = document.getElementById('start-overlay');

const renderer = createRenderer(canvas);
const camera = createCamera();
const scene = createSceneWithLighting();
scene.add(createGroundPlane());

const world = createWorld();
const playerMech = addMech(world, createMech('player', 'allies'));

const mechMeshHandle = createPlaceholderMechMesh();
scene.add(mechMeshHandle.root);

const input = new InputManager(canvas, overlay);

const loop = new GameLoop((dt) => {
  const { throttleInput, legTurnInput } = input.getMovementInputs();
  applyThrottleInput(playerMech, throttleInput, dt);
  applyLegTurnInput(playerMech, legTurnInput, dt);
  integrateMovement(playerMech, dt);

  const look = input.consumeLookDelta();
  applyLookYaw(playerMech, -look.x * LOOK_YAW_SENSITIVITY);
  applyLookPitch(playerMech, -look.y * LOOK_PITCH_SENSITIVITY);

  decayHeat(playerMech, dt);

  updateCameraFromMech(camera, playerMech, mechMeshHandle);
  renderer.render(scene, camera);
});

loop.start();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
