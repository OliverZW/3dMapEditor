import { describe, expect, it, vi } from 'vitest';
import { GpuTimer } from '../src/renderer/gpu-timer';
import { performanceDistribution } from '../src/renderer/performance-statistics';

describe('发布版性能统计', () => {
  it('使用帧间隔的最近秩 P95，空 GPU 样本明确为空', () => {
    expect(performanceDistribution([])).toBeNull();
    const input = [...Array(19).fill(10), 100] as number[];
    expect(performanceDistribution(input)).toEqual({
      samples: 20,
      mean: 14.5,
      median: 10,
      p95: 10,
      max: 100,
    });
    expect(input.at(-1)).toBe(100);
  });
  function context(supported = true) {
    let disjoint = false,
      available = true;
    const gl = {
      QUERY_RESULT_AVAILABLE: 1,
      QUERY_RESULT: 2,
      getExtension: () => (supported ? { TIME_ELAPSED_EXT: 3, GPU_DISJOINT_EXT: 4 } : null),
      getParameter: () => disjoint,
      createQuery: () => ({}),
      beginQuery: vi.fn(),
      endQuery: vi.fn(),
      deleteQuery: vi.fn(),
      getQueryParameter: (_query: unknown, parameter: number) =>
        parameter === 1 ? available : 5_000_000,
    };
    return {
      gl,
      timer: new GpuTimer(gl as unknown as WebGL2RenderingContext),
      setDisjoint: () => {
        disjoint = true;
      },
      delay: () => {
        available = false;
      },
    };
  }
  it('扩展不可用时不伪造 GPU 耗时', () => {
    const { timer, gl } = context(false);
    timer.begin();
    timer.end();
    timer.poll();
    timer.dispose();
    expect(timer.samples).toEqual([]);
    expect(gl.beginQuery).not.toHaveBeenCalled();
  });
  it('读取可用异步结果并转换纳秒为毫秒', () => {
    const { timer, gl } = context();
    timer.begin();
    timer.end();
    timer.poll();
    timer.dispose();
    expect(timer.samples).toEqual([5]);
    expect(gl.deleteQuery).toHaveBeenCalledTimes(1);
  });
  it('disjoint 时丢弃待处理结果，释放查询', () => {
    const { timer, gl, setDisjoint } = context();
    timer.begin();
    timer.end();
    setDisjoint();
    timer.poll();
    timer.dispose();
    expect(timer.samples).toEqual([]);
    expect(timer.disjointCount).toBe(1);
    expect(gl.deleteQuery).toHaveBeenCalledTimes(1);
  });
  it('驱动未返回结果时限制查询数量，结束后全部释放', () => {
    const { timer, gl, delay } = context();
    delay();
    for (let i = 0; i < 12; i++) {
      timer.begin();
      timer.end();
    }
    expect(timer.skipped).toBe(4);
    expect(gl.beginQuery).toHaveBeenCalledTimes(8);
    timer.dispose();
    expect(gl.deleteQuery).toHaveBeenCalledTimes(8);
  });
});
