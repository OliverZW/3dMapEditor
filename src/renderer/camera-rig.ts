import * as THREE from 'three';
export type AxisView = '+x' | '+y' | '+z';
export type Projection = 'perspective' | 'orthographic';
export class CameraRig {
  readonly perspective = new THREE.PerspectiveCamera(43, 1, 0.5, 12000);
  readonly orthographic = new THREE.OrthographicCamera(-900, 900, 900, -900, 0.5, 12000);
  readonly target = new THREE.Vector3(0, 32, 0);
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspective;
  orientation: AxisView | 'free' = 'free';
  private aspect = 1;
  private framedDiameter = 0;
  private animation: {
    from: THREE.Quaternion;
    to: THREE.Quaternion;
    radius: number;
    elapsed: number;
  } | null = null;
  constructor() {
    this.camera.position.set(700, 870, 1050);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld(true);
  }
  get projection(): Projection {
    return this.camera === this.perspective ? 'perspective' : 'orthographic';
  }
  get animating() {
    return this.animation !== null;
  }
  resize(width: number, height: number) {
    this.aspect = width / height;
    this.perspective.aspect = this.aspect;
    this.perspective.updateProjectionMatrix();
    this.orthographic.left = -900 * this.aspect;
    this.orthographic.right = 900 * this.aspect;
    this.orthographic.updateProjectionMatrix();
  }
  toggleProjection() {
    this.interrupt();
    const previous = this.camera,
      radius = previous.position.distanceTo(this.target);
    const direction = previous.getWorldDirection(new THREE.Vector3()).negate();
    if (this.projection === 'perspective') {
      const visibleHeight =
        2 * radius * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2));
      this.camera = this.orthographic;
      this.orthographic.zoom = 1800 / visibleHeight;
      this.camera.position.copy(previous.position);
    } else {
      const visibleHeight = 1800 / this.orthographic.zoom;
      const distance =
        visibleHeight / (2 * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2)));
      this.camera = this.perspective;
      this.camera.position.copy(this.target).addScaledVector(direction, distance);
    }
    this.camera.quaternion.copy(previous.quaternion);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld(true);
  }
  snap(axis: AxisView) {
    const directions: Record<AxisView, THREE.Vector3> = {
      '+x': new THREE.Vector3(1, 0, 0),
      '+y': new THREE.Vector3(0, 1, 0),
      '+z': new THREE.Vector3(0, 0, 1),
    };
    const up = axis === '+y' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const matrix = new THREE.Matrix4().lookAt(directions[axis], new THREE.Vector3(), up);
    this.animateTo(new THREE.Quaternion().setFromRotationMatrix(matrix));
    this.orientation = axis;
  }
  resetPerspective() {
    if (this.projection !== 'perspective') this.toggleProjection();
    const matrix = new THREE.Matrix4().lookAt(
      new THREE.Vector3(0.5, 0.65, 0.75),
      new THREE.Vector3(),
      new THREE.Vector3(0, 1, 0),
    );
    this.animateTo(new THREE.Quaternion().setFromRotationMatrix(matrix));
    this.orientation = 'free';
  }
  private animateTo(to: THREE.Quaternion) {
    this.animation = {
      from: this.camera.quaternion.clone(),
      to,
      radius: this.camera.position.distanceTo(this.target),
      elapsed: 0,
    };
  }
  update(delta: number) {
    const animation = this.animation;
    if (!animation) return;
    animation.elapsed += delta;
    const t = Math.min(1, animation.elapsed / 0.2),
      eased = t * t * (3 - 2 * t);
    this.camera.quaternion.slerpQuaternions(animation.from, animation.to, eased);
    this.camera.position
      .set(0, 0, 1)
      .applyQuaternion(this.camera.quaternion)
      .multiplyScalar(animation.radius)
      .add(this.target);
    if (t === 1) this.animation = null;
    this.camera.updateMatrixWorld(true);
  }
  interrupt() {
    this.animation = null;
  }
  frame(center: THREE.Vector3, diameter: number) {
    this.interrupt();
    const direction = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    this.target.copy(center);
    this.framedDiameter = diameter;
    const size = Math.max(12, diameter) / Math.min(1, this.aspect);
    const distance = size / (2 * Math.sin(THREE.MathUtils.degToRad(this.perspective.fov / 2)));
    this.camera.position.copy(center).addScaledVector(direction, distance);
    if (this.projection === 'orthographic') {
      this.orthographic.zoom = 1800 / size;
      this.orthographic.updateProjectionMatrix();
    }
    for (const camera of [this.perspective, this.orthographic]) {
      camera.far = Math.max(12000, distance + size * 2);
      camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld(true);
  }
  look(dx: number, dy: number) {
    this.interrupt();
    const radius = this.camera.position.distanceTo(this.target);
    const angles = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    angles.y -= dx * 0.003;
    angles.x = THREE.MathUtils.clamp(
      angles.x - dy * 0.003,
      -Math.PI / 2 + 0.001,
      Math.PI / 2 - 0.001,
    );
    angles.z = 0;
    this.camera.quaternion.setFromEuler(angles);
    this.target
      .copy(this.camera.position)
      .addScaledVector(this.camera.getWorldDirection(new THREE.Vector3()), radius);
    this.orientation = 'free';
  }
  orbit(dx: number, dy: number) {
    this.interrupt();
    const offset = this.camera.position.clone().sub(this.target),
      spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta -= dx * 0.005;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi - dy * 0.005, 0.00001, Math.PI - 0.00001);
    this.camera.position.copy(this.target).add(new THREE.Vector3().setFromSpherical(spherical));
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target);
    this.orientation = 'free';
  }
  pan(dx: number, dy: number, height: number) {
    this.interrupt();
    const radius = this.camera.position.distanceTo(this.target);
    const scale =
      (this.projection === 'orthographic'
        ? 1800 / this.orthographic.zoom
        : 2 * radius * Math.tan(THREE.MathUtils.degToRad(this.perspective.fov / 2))) / height;
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const translation = right.multiplyScalar(-dx * scale).addScaledVector(up, dy * scale);
    this.camera.position.add(translation);
    this.target.add(translation);
  }
  dolly(amount: number) {
    this.interrupt();
    if (this.projection === 'orthographic') {
      this.orthographic.zoom = THREE.MathUtils.clamp(
        this.orthographic.zoom * Math.exp(-amount),
        0.05,
        200,
      );
      this.orthographic.updateProjectionMatrix();
    } else {
      const offset = this.camera.position.clone().sub(this.target),
        distance = THREE.MathUtils.clamp(
          offset.length() * Math.exp(amount),
          12,
          Math.max(8000, this.framedDiameter * 4),
        );
      this.camera.position.copy(this.target).add(offset.setLength(distance));
    }
  }
  move(input: THREE.Vector3, distance: number) {
    this.interrupt();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const forward =
      this.projection === 'perspective'
        ? this.camera.getWorldDirection(new THREE.Vector3())
        : new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    const movement = right.multiplyScalar(input.x).addScaledVector(forward, input.z);
    if (this.projection === 'perspective') movement.y += input.y;
    if (movement.lengthSq() > 0) {
      movement.normalize().multiplyScalar(distance);
      this.camera.position.add(movement);
      this.target.add(movement);
    }
  }
}
