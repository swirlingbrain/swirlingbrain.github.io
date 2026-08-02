import { computeMovementInputs } from './InputState.js';

export class InputManager {
  constructor(canvas, overlay) {
    this.keysDown = new Set();
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    this.fireHeld = false;
    this.canvas = canvas;

    overlay.addEventListener('click', () => canvas.requestPointerLock());

    document.addEventListener('pointerlockchange', () => {
      overlay.style.display = document.pointerLockElement === canvas ? 'none' : 'flex';
      if (document.pointerLockElement !== canvas) this.fireHeld = false;
    });

    document.addEventListener('keydown', (e) => this.keysDown.add(e.code));
    document.addEventListener('keyup', (e) => this.keysDown.delete(e.code));

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      this.lookDeltaX += e.movementX;
      this.lookDeltaY += e.movementY;
    });

    document.addEventListener('mousedown', (e) => {
      if (document.pointerLockElement !== canvas || e.button !== 0) return;
      this.fireHeld = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button !== 0) return;
      this.fireHeld = false;
    });
  }

  isFireHeld() {
    return this.fireHeld;
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
