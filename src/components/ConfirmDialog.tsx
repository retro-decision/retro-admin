import { useEffect, useState } from 'react';
import {
  MUTE_DURATION_OPTIONS,
  type MuteDurationDays,
} from '../lib/format';

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
  /** When set, the dialog requires a mute duration before confirm. */
  durationRequired?: boolean;
  durationLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string, durationDays?: MuteDurationDays) => void;
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
  durationRequired = false,
  durationLabel = '禁言時長',
  busy = false,
  onCancel,
  onConfirm,
}: Props) {
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState<string>('');

  useEffect(() => {
    if (open) {
      setReason('');
      setDuration('');
    }
  }, [open]);

  if (!open) return null;

  const durationDays: MuteDurationDays | undefined =
    duration === ''
      ? undefined
      : duration === 'permanent'
        ? null
        : (Number(duration) as MuteDurationDays);

  const canConfirm =
    !busy &&
    (!reasonRequired || reason.trim().length > 0) &&
    (!durationRequired || duration !== '');

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
        {durationRequired ? (
          <fieldset className="field duration-field">
            <legend>
              {durationLabel}
              <span>（必填）</span>
            </legend>
            {durationDays !== undefined ? (
              <p className="modal-message duration-preview">
                {durationDays == null
                  ? '將永久禁言此帳戶。'
                  : `將禁言此帳戶 ${durationDays} 天。到期後會自動解除。`}
              </p>
            ) : null}
            <div className="duration-options" role="radiogroup" aria-label={durationLabel}>
              {MUTE_DURATION_OPTIONS.map((opt) => {
                const value = opt.value == null ? 'permanent' : String(opt.value);
                return (
                  <label key={value} className={duration === value ? 'on' : undefined}>
                    <input
                      type="radio"
                      name="mute-duration"
                      value={value}
                      checked={duration === value}
                      disabled={busy}
                      onChange={() => setDuration(value)}
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        ) : null}
        {reasonLabel ? (
          <label className="field">
            <span>
              {reasonLabel}
              {reasonRequired ? '（必填）' : '（選填）'}
            </span>
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
            onClick={() => onConfirm(reason, durationDays)}
          >
            {busy ? '處理中…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
