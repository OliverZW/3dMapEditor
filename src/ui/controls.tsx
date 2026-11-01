import { useRef } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { CircleHelp } from 'lucide-react';
export function HelpTip({ label, text }: { label: string; text: string }) {
  return (
    <button
      type="button"
      className="help-tip"
      title={text}
      aria-label={`${label}说明`}
      onClick={(event) => event.preventDefault()}
    >
      <CircleHelp size={14} />
    </button>
  );
}
export function Button({
  children,
  icon: Icon,
  onClick,
  active,
  disabled = false,
  title = '',
  className = '',
  'aria-label': ariaLabel,
}: {
  children?: ReactNode;
  icon?: LucideIcon;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <button
      title={title}
      aria-label={ariaLabel}
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
  hint,
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
  hint?: string;
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
    <div className="slider-field">
      <span>
        <span className="setting-label">
          {label}
          {hint && <HelpTip label={label} text={hint} />}
        </span>
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
    </div>
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
