/** 合并同帧刷新；异步资源完成自行唤醒，不用持续轮询加载状态。 */
export class DemandFrameLoop {
  private frame: number | null = null;
  private active = true;
  private disposed = false;
  constructor(
    private draw: () => boolean,
    private sleep: () => void,
    private request: (callback: FrameRequestCallback) => number = (callback) =>
      requestAnimationFrame(callback),
    private cancel: (frame: number) => void = (frame) => cancelAnimationFrame(frame),
  ) {}
  get pending() {
    return this.frame !== null;
  }
  invalidate = () => {
    if (!this.disposed && this.active && this.frame === null) this.frame = this.request(this.tick);
  };
  private tick = () => {
    this.frame = null;
    if (this.disposed || !this.active) return;
    if (this.draw()) this.invalidate();
    if (!this.pending) this.sleep();
  };
  setActive(active: boolean) {
    this.active = active;
    if (!active && this.frame !== null) {
      this.cancel(this.frame);
      this.frame = null;
    }
    if (active) this.invalidate();
    else this.sleep();
  }
  dispose() {
    this.disposed = true;
    if (this.frame !== null) this.cancel(this.frame);
    this.frame = null;
  }
}
