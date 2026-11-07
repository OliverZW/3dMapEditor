import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  className = '',
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      className="modal-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        ref={dialog}
        tabIndex={-1}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
            onClose();
            return;
          }
          if (event.key !== 'Tab') return;
          const items = [
            ...dialog.current!.querySelectorAll<HTMLElement>(
              'button,input,select,textarea,[tabindex="0"]',
            ),
          ].filter((node) => !node.hasAttribute('disabled') && node.getClientRects().length > 0);
          if (!items.length) {
            event.preventDefault();
            return;
          }
          const first = items[0],
            last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? 'wide' : ''} ${className}`}
      >
        <div className="modal-title">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} title="关闭">
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
