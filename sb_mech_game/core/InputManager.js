import { computeMovementInputs } from './InputState.js';

export class InputManager {
  constructor(canvas, overlay) {
    this.keysDown = new Set();
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;

    overlay.addEventListener('click', () => canvas.requestPointerLock());

    document.addEventListener('pointerlockchange', () => {
      overlay.style.display = document.pointerLockElement === canvas ? 'none' : 'flex';
    });

    document.addEventListener('keydown', (e) => this.keysDown.add(e.code));
    document.addEventListener('keyup', (e) => this.keysDown.delete(e.code));

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      this.lookDeltaX += e.movementX;
      this.lookDeltaY += e.movementY;
    });
  }

  getMovementInputs() {
    return computeMovementInputs(this.keysDown);
  }

  consumeLookDelta() {
    const delta = { x: this.lookDeltaX, y: this.lookDeltaY };
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    return delta;
  }
}
