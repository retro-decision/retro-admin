import { useEffect, useState } from 'react';

type Props = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonRequired?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = '確認',
  cancelLabel = '取消',
  danger = false,
  reasonLabel,
  reasonPlaceholder,
  reasonRequired = false,
  busy = false,
  onCancel,
  onConfirm,
}: Props) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  if (!open) return null;

  const canConfirm = !busy && (!reasonRequired || reason.trim().length > 0);

  return (
    <div className="modal-backdrop" role="presentation" onClick={() => !busy && onCancel()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title">{title}</h2>
        <p className="modal-message">{message}</p>
        {reasonLabel ? (
          <label className="field">
            <span>{reasonLabel}{reasonRequired ? '（必填）' : '（選填）'}</span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder={reasonPlaceholder}
              disabled={busy}
            />
          </label>
        ) : null}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={!canConfirm}
            onClick={() => onConfirm(reason)}
          >
            {busy ? '處理中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
