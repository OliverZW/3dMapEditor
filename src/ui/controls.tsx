import { useRef } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
export function Button({
  children,
  icon: Icon,
  onClick,
  active,
  disabled = false,
  title = '',
  className = '',
}: {
  children?: ReactNode;
  icon?: LucideIcon;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={`${active ? 'active ' : ''}${className}`}
    >
      {Icon && <Icon size={16} />}
      <span>{children}</span>
    </button>
  );
}
export function Group({
  title,
  children,
  tag,
}: {
  title: string;
  children: ReactNode;
  tag?: string;
}) {
  return (
    <section className="property-group">
      <div className="group-title">
        {title}
        {tag && <small>{tag}</small>}
      </div>
      {children}
    </section>
  );
}
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange,
  onCommit,
  onCancel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
  onCommit?: () => void;
  onCancel?: () => void;
}) {
  const dragging = useRef(false);
  return (
    <label className="slider-field">
      <span>
        {label}
        <b>
          {Number(value.toFixed(2))}
          <em>{unit}</em>
        </b>
      </span>
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        style={{
          background: `linear-gradient(90deg, var(--blue) ${((value - min) / (max - min)) * 100}%, var(--control-border) ${((value - min) / (max - min)) * 100}%)`,
        }}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={() => {
          dragging.current = true;
        }}
        onPointerUp={() => {
          dragging.current = false;
          onCommit?.();
        }}
        onPointerCancel={() => {
          dragging.current = false;
          onCancel?.();
        }}
        onBlur={() => {
          if (dragging.current) {
            dragging.current = false;
            onCancel?.();
          } else onCommit?.();
        }}
        onKeyUp={(event) => {
          if (
            [
              'ArrowLeft',
              'ArrowRight',
              'ArrowUp',
              'ArrowDown',
              'Home',
              'End',
              'PageUp',
              'PageDown',
            ].includes(event.key)
          )
            onCommit?.();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && onCancel) {
            event.stopPropagation();
            onCancel();
          }
        }}
      />
    </label>
  );
}
export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <input
        aria-label={label}
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (
            e.target.value !== '' &&
            Number.isFinite(v) &&
            (min === undefined || v >= min) &&
            (max === undefined || v <= max)
          )
            onChange(v);
        }}
      />
    </label>
  );
}
