import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from './Modal';
import { Button } from './controls';

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  disabled = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  disabled?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return createPortal(
    <Modal title={title} onClose={onCancel}>
      <div className="modal-body confirm-dialog-body">{children}</div>
      <div className="modal-actions">
        <Button onClick={onCancel}>取消删除</Button>
        <Button className="danger" disabled={disabled} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>,
    document.body,
  );
}
