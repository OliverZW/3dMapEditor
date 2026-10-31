import * as THREE from 'three';
import { CameraRig } from './camera-rig';
import type { AxisView, Projection } from './camera-rig';
export interface NavigationState {
  projection: Projection;
  orientation: AxisView | 'free';
  speed: number;
  gesture: 'idle' | 'fly' | 'pan' | 'orbit' | 'dolly';
}
export class CameraNavigation {
  readonly rig = new CameraRig();
  private state: NavigationState = {
    projection: 'perspective',
    orientation: 'free',
    speed: 100,
    gesture: 'idle',
  };
  private listeners = new Set<() => void>();
  private poses = new Set<() => void>();
  private keys = new Set<string>();
  private pointerId: number | null = null;
  private previous = { x: 0, y: 0 };
  private space = false;
  private hovered = false;
  private keyboardPan = false;
  private accelerating = false;
  private blocked = false;
  private lastQuaternion = new THREE.Quaternion(0, 0, 0, 0);
  private lastProjection = '';
  constructor(
    private canvas: HTMLCanvasElement,
    private commands: {
      focus: () => void;
      frameAll: () => void;
      toggleGrid: () => void;
      editing: () => boolean;
      cancelEditing: () => void;
    },
  ) {
    canvas.tabIndex = 0;
    canvas.addEventListener('pointerdown', this.pointerDown, true);
    canvas.addEventListener('pointermove', this.pointerMove, true);
    canvas.addEventListener('pointerup', this.pointerUp, true);
    canvas.addEventListener('pointercancel', this.pointerUp, true);
    canvas.addEventListener('lostpointercapture', this.pointerUp, true);
    canvas.addEventListener('pointerenter', this.pointerEnter);
    canvas.addEventListener('pointerleave', this.pointerLeave);
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    canvas.addEventListener('contextmenu', this.contextMenu);
    window.addEventListener('keydown', this.keyDown);
    window.addEventListener('keyup', this.keyUp);
    window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.visibility);
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.state;
  subscribePose(listener: () => void) {
    this.poses.add(listener);
    listener();
    return () => {
      this.poses.delete(listener);
    };
  }
  private emit() {
    this.state = {
      ...this.state,
      projection: this.rig.projection,
      orientation: this.rig.orientation,
    };
    this.listeners.forEach((listener) => listener());
  }
  setBlocked(blocked: boolean) {
    this.blocked = blocked;
    if (blocked) {
      this.stop();
      this.commands.cancelEditing();
    }
  }
  toggleProjection() {
    if (this.blocked || this.commands.editing()) return;
    this.stop();
    this.rig.toggleProjection();
    this.emit();
  }
  snap(axis: AxisView) {
    if (this.blocked || this.commands.editing()) return;
    this.stop();
    this.rig.snap(axis);
    this.emit();
  }
  resetPerspective() {
    if (this.blocked || this.commands.editing()) return;
    this.stop();
    this.rig.resetPerspective();
    this.emit();
  }
  frame(center: THREE.Vector3, diameter: number) {
    this.stop();
    this.rig.frame(center, diameter);
    this.emit();
  }
  private stop() {
    this.keys.clear();
    this.space = false;
    this.keyboardPan = false;
    this.accelerating = false;
    const id = this.pointerId;
    this.pointerId = null;
    if (id !== null && this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
    if (this.state.gesture !== 'idle') {
      this.state = { ...this.state, gesture: 'idle' };
      this.emit();
    }
  }
  private pointerEnter = () => {
    this.hovered = true;
  };
  private pointerLeave = () => {
    this.hovered = false;
  };
  private pointerDown = (event: PointerEvent) => {
    if (this.blocked || this.commands.editing()) return;
    let gesture: NavigationState['gesture'] = 'idle';
    if (event.button === 2)
      gesture = event.altKey ? 'dolly' : this.rig.projection === 'perspective' ? 'fly' : 'pan';
    else if (event.button === 1 || (event.button === 0 && this.space)) gesture = 'pan';
    else if (event.button === 0 && event.altKey && this.rig.projection === 'perspective')
      gesture = 'orbit';
    else if (event.button === 0 && event.altKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (gesture === 'idle') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.rig.interrupt();
    this.keyboardPan = event.button === 2;
    this.accelerating = event.shiftKey;
    this.pointerId = event.pointerId;
    this.previous = { x: event.clientX, y: event.clientY };
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(event.pointerId);
    this.state = { ...this.state, gesture };
    this.emit();
  };
  private pointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const dx = event.clientX - this.previous.x,
      dy = event.clientY - this.previous.y;
    this.previous = { x: event.clientX, y: event.clientY };
    if (this.state.gesture === 'fly') this.rig.look(dx, dy);
    else if (this.state.gesture === 'orbit') this.rig.orbit(dx, dy);
    else if (this.state.gesture === 'pan') this.rig.pan(dx, dy, this.canvas.clientHeight);
    else if (this.state.gesture === 'dolly') this.rig.dolly(dy * 0.01);
    if (this.state.orientation !== this.rig.orientation) this.emit();
  };
  private pointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.stop();
  };
  private wheel = (event: WheelEvent) => {
    event.preventDefault();
    if (this.blocked || this.commands.editing()) return;
    if (this.state.gesture === 'fly') {
      this.state = {
        ...this.state,
        speed: THREE.MathUtils.clamp(
          this.state.speed * Math.pow(1.2, -Math.sign(event.deltaY)),
          5,
          1000,
        ),
      };
      this.emit();
    } else this.rig.dolly(event.deltaY * 0.001);
  };
  private contextMenu = (event: Event) => event.preventDefault();
  private keyDown = (event: KeyboardEvent) => {
    if (
      this.blocked ||
      event.isComposing ||
      (event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')
    )
      return;
    if (event.key === 'Escape' && this.state.gesture !== 'idle') {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.stop();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (this.state.gesture === 'fly' || (this.state.gesture === 'pan' && this.keyboardPan)) {
      if (
        ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'].includes(
          event.code,
        )
      ) {
        this.accelerating = event.shiftKey;
        this.keys.add(event.code);
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
    }
    if (
      event.code === 'Space' &&
      (this.hovered || document.activeElement === this.canvas) &&
      !(event.target as HTMLElement).closest('button') &&
      !this.commands.editing()
    ) {
      this.space = true;
      event.preventDefault();
      return;
    }
    if (event.repeat || this.commands.editing() || this.state.gesture !== 'idle') return;
    if (event.code === 'KeyF') {
      event.preventDefault();
      this.commands.focus();
    } else if (event.code === 'Home') {
      event.preventDefault();
      this.commands.frameAll();
    } else if (event.code === 'KeyV') {
      event.preventDefault();
      this.toggleProjection();
    } else if (event.code === 'KeyG') {
      event.preventDefault();
      this.commands.toggleGrid();
    }
  };
  private keyUp = (event: KeyboardEvent) => {
    this.accelerating = event.shiftKey;
    this.keys.delete(event.code);
    if (event.code === 'Space') this.space = false;
  };
  private blur = () => this.stop();
  private visibility = () => {
    if (document.hidden) this.stop();
  };
  update(delta: number) {
    if (this.blocked) return;
    const flying =
      this.state.gesture === 'fly' || (this.state.gesture === 'pan' && this.keyboardPan);
    if (flying && this.keys.size) {
      const input = new THREE.Vector3(
        Number(this.keys.has('KeyD')) - Number(this.keys.has('KeyA')),
        Number(this.keys.has('KeyE')) - Number(this.keys.has('KeyQ')),
        Number(this.keys.has('KeyW')) - Number(this.keys.has('KeyS')),
      );
      const accelerated = this.accelerating;
      this.rig.move(
        input,
        this.state.speed * (accelerated ? 4 : 1) * Math.min(0.1, Math.max(0, delta)),
      );
    }
    this.rig.update(delta);
    this.rig.camera.updateMatrixWorld(true);
    if (
      !this.lastQuaternion.equals(this.rig.camera.quaternion) ||
      this.lastProjection !== this.rig.projection
    ) {
      this.lastQuaternion.copy(this.rig.camera.quaternion);
      this.lastProjection = this.rig.projection;
      this.poses.forEach((listener) => listener());
    }
  }
  dispose() {
    this.stop();
    this.canvas.removeEventListener('pointerdown', this.pointerDown, true);
    this.canvas.removeEventListener('pointermove', this.pointerMove, true);
    this.canvas.removeEventListener('pointerup', this.pointerUp, true);
    this.canvas.removeEventListener('pointercancel', this.pointerUp, true);
    this.canvas.removeEventListener('lostpointercapture', this.pointerUp, true);
    this.canvas.removeEventListener('pointerenter', this.pointerEnter);
    this.canvas.removeEventListener('pointerleave', this.pointerLeave);
    this.canvas.removeEventListener('wheel', this.wheel);
    this.canvas.removeEventListener('contextmenu', this.contextMenu);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.blur);
    document.removeEventListener('visibilitychange', this.visibility);
    this.listeners.clear();
    this.poses.clear();
  }
}
