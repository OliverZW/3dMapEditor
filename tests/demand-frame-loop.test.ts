import { describe, expect, it } from 'vitest';
import { DemandFrameLoop } from '../src/renderer/demand-frame-loop';

function fixture(draw: () => boolean) {
  let next = 0,
    sleeps = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const loop = new DemandFrameLoop(
    draw,
    () => sleeps++,
    (fn) => {
      frames.set(++next, fn);
      return next;
    },
    (id) => {
      frames.delete(id);
    },
  );
  return {
    loop,
    frames,
    sleeps: () => sleeps,
    tick: () => {
      const entry = frames.entries().next().value;
      if (!entry) throw new Error('没有待执行帧');
      frames.delete(entry[0]);
      entry[1](0);
    },
  };
}

describe('按需画面调度', () => {
  it('合并刷新，静止后不再提交，资源就绪能够再次唤醒', () => {
    let draws = 0;
    const f = fixture(() => {
      draws++;
      return false;
    });
    f.loop.invalidate();
    f.loop.invalidate();
    expect(f.frames.size).toBe(1);
    f.tick();
    expect(draws).toBe(1);
    expect(f.frames.size).toBe(0);
    expect(f.sleeps()).toBe(1);
    f.loop.invalidate();
    f.tick();
    expect(draws).toBe(2);
    expect(f.frames.size).toBe(0);
  });
  it('动画和绘制期间新增刷新共享一个下一帧，动画结束即停止', () => {
    let moving = true;
    const f = fixture(() => {
      f.loop.invalidate();
      return moving;
    });
    f.loop.invalidate();
    f.tick();
    expect(f.frames.size).toBe(1);
    moving = false;
    // 绘制期间仍发生失效，保留下一帧而不丢更新。
    f.tick();
    expect(f.frames.size).toBe(1);
    f.loop.dispose();
    expect(f.frames.size).toBe(0);
  });
  it('最后一个动画帧后不再调度', () => {
    let moving = true;
    const f = fixture(() => moving);
    f.loop.invalidate();
    f.tick();
    expect(f.frames.size).toBe(1);
    moving = false;
    f.tick();
    expect(f.frames.size).toBe(0);
    expect(f.sleeps()).toBe(1);
  });
  it('隐藏时取消帧且忽略唤醒，恢复后刷新，释放后永不重启', () => {
    let draws = 0;
    const f = fixture(() => {
      draws++;
      return true;
    });
    f.loop.invalidate();
    f.loop.setActive(false);
    f.loop.invalidate();
    expect(f.frames.size).toBe(0);
    f.loop.setActive(true);
    f.tick();
    expect(draws).toBe(1);
    expect(f.frames.size).toBe(1);
    f.loop.dispose();
    f.loop.setActive(true);
    f.loop.invalidate();
    expect(f.frames.size).toBe(0);
  });
});
