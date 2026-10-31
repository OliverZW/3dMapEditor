import type { Mesh } from 'three';

/** 只挂接正式模型的颜色批次，按实际提交量计数，包含实例和透明材质的双面绘制。 */
export class ModelRenderCounter {
  triangles = 0;

  reset() {
    this.triangles = 0;
  }

  track(mesh: Mesh) {
    const beforeRender = mesh.onBeforeRender;
    const afterRender = mesh.onAfterRender;
    let before = 0;
    mesh.onBeforeRender = (...args) => {
      beforeRender.apply(mesh, args);
      before = args[0].info.render.triangles;
    };
    mesh.onAfterRender = (...args) => {
      this.triangles += args[0].info.render.triangles - before;
      afterRender.apply(mesh, args);
    };
  }
}
