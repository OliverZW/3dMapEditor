interface TimerExtension {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

/** 异步读取 GPU 查询；不调用 finish 或同步等待，不支持时保留空样本。 */
export class GpuTimer {
  readonly extension: TimerExtension | null;
  readonly samples: number[] = [];
  disjointCount = 0;
  skipped = 0;
  private pending: WebGLQuery[] = [];
  private active: WebGLQuery | null = null;
  constructor(private gl: WebGL2RenderingContext) {
    this.extension = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  }
  poll() {
    const { gl, extension: ext } = this;
    if (!ext) return;
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
      this.disjointCount++;
      for (const query of this.pending) gl.deleteQuery(query);
      this.pending = [];
      return;
    }
    while (
      this.pending.length &&
      gl.getQueryParameter(this.pending[0], gl.QUERY_RESULT_AVAILABLE)
    ) {
      const query = this.pending.shift()!;
      this.samples.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(query);
    }
  }
  begin() {
    this.poll();
    if (!this.extension) return;
    if (this.pending.length >= 8) {
      this.skipped++;
      return;
    }
    this.active = this.gl.createQuery();
    if (this.active) this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, this.active);
  }
  end() {
    if (!this.active || !this.extension) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }
  dispose() {
    this.end();
    for (const query of this.pending) this.gl.deleteQuery(query);
    this.pending = [];
  }
}
