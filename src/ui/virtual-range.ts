export function virtualRange(
  count: number,
  scrollTop: number,
  height: number,
  rowHeight = 64,
  overscan = 4,
) {
  const firstVisible = Math.max(0, Math.min(count - 1, Math.floor(scrollTop / rowHeight)));
  const start = Math.max(0, firstVisible - overscan);
  const end = Math.min(count, firstVisible + Math.ceil(height / rowHeight) + overscan);
  return { start, end, totalHeight: count * rowHeight };
}
