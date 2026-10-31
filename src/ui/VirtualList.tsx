import { useEffect, useRef, useState } from 'react';
import type { ReactNode, KeyboardEvent } from 'react';
import { virtualRange } from './virtual-range';
export function VirtualList<T>({
  items,
  getId,
  renderRow,
  selectedId,
  onSelect,
  label,
}: {
  items: T[];
  getId: (item: T) => string;
  renderRow: (item: T) => ReactNode;
  selectedId?: string;
  onSelect: (item: T) => void;
  label: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0),
    [height, setHeight] = useState(256);
  const { start, end, totalHeight } = virtualRange(items.length, scrollTop, height);
  useEffect(() => {
    const observer = new ResizeObserver(() => setHeight(element.current?.clientHeight ?? 256));
    observer.observe(element.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const index = items.findIndex((item) => getId(item) === selectedId),
      node = element.current;
    if (index < 0 || !node) return;
    if (index * 64 < node.scrollTop) node.scrollTop = index * 64;
    else if ((index + 1) * 64 > node.scrollTop + node.clientHeight)
      node.scrollTop = (index + 1) * 64 - node.clientHeight;
  }, [selectedId, items, getId]);
  function keyDown(event: KeyboardEvent) {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!items.length) return;
    let index = items.findIndex((item) => getId(item) === selectedId);
    if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = items.length - 1;
    else if (event.key === 'ArrowDown') index = Math.min(items.length - 1, index + 1);
    else if (event.key === 'ArrowUp') index = Math.max(0, index - 1);
    if (index >= 0) onSelect(items[index]);
  }
  return (
    <div
      className="virtual-list"
      ref={element}
      tabIndex={0}
      role="listbox"
      aria-label={label}
      onKeyDown={keyDown}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="virtual-list-space" style={{ height: totalHeight }}>
        {items.slice(start, end).map((item, offset) => (
          <div
            key={getId(item)}
            role="option"
            aria-selected={getId(item) === selectedId}
            className={'model-list-row ' + (getId(item) === selectedId ? 'selected' : '')}
            style={{ top: (start + offset) * 64, height: 64 }}
            onClick={() => {
              element.current?.focus({ preventScroll: true });
              onSelect(item);
            }}
          >
            {renderRow(item)}
          </div>
        ))}
      </div>
      {!items.length && <p className="empty">没有符合条件的模型</p>}
    </div>
  );
}
