"use client";

type ConfirmDialogProps = {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ message, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="confirm-dialog-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
        <p className="confirm-dialog-message">{message}</p>
        <div className="confirm-dialog-actions">
          <button className="btn btn-ghost" onClick={onCancel} type="button">
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={onConfirm} type="button">
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}
