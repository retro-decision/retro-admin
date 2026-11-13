import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  AdminApiError,
  blockAccount,
  fetchProfiles,
  listAccountBlocks,
  unblockAccount,
  type AccountBlock,
} from '../lib/api';
import {
  MUTE_DURATION_OPTIONS,
  blockConfirmCopy,
  blockStatus,
  blockStatusLabel,
  displayName,
  formatHkt,
  isMuteDurationDays,
  muteDurationLabel,
  shortId,
  type MuteDurationDays,
} from '../lib/format';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DialogKind =
  | { type: 'block'; userId: string; reason: string; durationDays: MuteDurationDays }
  | { type: 'unblock'; row: AccountBlock }
  | null;

export function BlocksPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<AccountBlock[]>([]);
  const [names, setNames] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState<string>('');
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listAccountBlocks();
      setRows(list);
      const ids = list.flatMap((r) => [r.user_id, r.blocked_by, r.unblocked_by]).filter((id): id is string => !!id);
      setNames(await fetchProfiles(ids));
    } catch (e) {
      setRows([]);
      setError(e instanceof AdminApiError ? e.message : '無法載入封鎖名單。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = useMemo(
    () => rows.filter((r) => blockStatus(r) === 'active'),
    [rows],
  );

  function who(id: string | null | undefined): string {
    if (!id) return '—';
    return `${displayName(names[id], id)} (${shortId(id)})`;
  }

  function startBlock(event: FormEvent) {
    event.preventDefault();
    const id = userId.trim();
    if (!UUID_RE.test(id)) {
      setError('請輸入有效的用戶 UUID。');
      return;
    }
    if (user && id === user.id) {
      setError('請勿封鎖自己的管理員帳戶。');
      return;
    }
    if (duration === '') {
      setError('請選擇禁言時長。');
      return;
    }
    const durationDays: MuteDurationDays = duration === 'permanent' ? null : (Number(duration) as MuteDurationDays);
    if (duration !== 'permanent' && !isMuteDurationDays(durationDays)) {
      setError('請選擇有效的禁言時長。');
      return;
    }
    setError(null);
    setDialog({ type: 'block', userId: id, reason: reason.trim(), durationDays });
  }

  async function run(action: () => Promise<void>) {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      setDialog(null);
      setUserId('');
      setReason('');
      setDuration('');
      await load();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : '操作失敗。');
    } finally {
      setBusy(false);
    }
  }

  function statusPill(row: AccountBlock) {
    const status = blockStatus(row);
    const cls = status === 'active' ? 'pill warn' : status === 'expired' ? 'pill expired' : 'pill ok';
    return <span className={cls}>{blockStatusLabel(status)}</span>;
  }

  function liftedCell(row: AccountBlock) {
    if (!row.unblocked_at && blockStatus(row) !== 'expired') return '—';
    if (row.unblock_reason === 'expired' && !row.unblocked_by) {
      return '到期自動解除';
    }
    if (!row.unblocked_at) return '—';
    return `${who(row.unblocked_by)}${row.unblock_reason?.trim() ? ` · ${row.unblock_reason.trim()}` : ''}`;
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>封鎖帳戶</h1>
          <p className="muted">
            可設定禁言 1、3、7、10、30、90、365 天或永久。封鎖後該用戶在時限內不能再參與命運酒館（發帖、留言、投票、乾杯、追蹤、檢舉）。不會禁止登入，也不會刪除個人決定或雲端備份。到期後會自動解除；管理員亦可提早解鎖。歷史紀錄會保留。
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}>
          重新整理
        </button>
      </div>

      {error ? <p className="banner error">{error}</p> : null}

      <form className="panel form-grid" onSubmit={startBlock}>
        <h2>新增封鎖</h2>
        <label className="field">
          <span>用戶 UUID</span>
          <input
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <fieldset className="field duration-field">
          <legend>禁言時長（必填）</legend>
          <div className="duration-options" role="radiogroup" aria-label="禁言時長">
            {MUTE_DURATION_OPTIONS.map((opt) => {
              const value = opt.value == null ? 'permanent' : String(opt.value);
              return (
                <label key={value} className={duration === value ? 'on' : undefined}>
                  <input
                    type="radio"
                    name="block-duration"
                    value={value}
                    checked={duration === value}
                    onChange={() => setDuration(value)}
                  />
                  {opt.label}
                </label>
              );
            })}
          </div>
        </fieldset>
        <label className="field">
          <span>原因（選填）</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="例如：重複發布廣告"
          />
        </label>
        <div>
          <button type="submit" className="btn btn-danger">
            封鎖此帳戶
          </button>
        </div>
      </form>

      <div className="panel">
        <h2>目前已封鎖（{active.length}）</h2>
        {loading && rows.length === 0 ? <p className="muted">載入中…</p> : null}
        {!loading && active.length === 0 ? <p className="muted">目前沒有已封鎖帳戶。</p> : null}
        {active.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>用戶</th>
                  <th>禁言時長</th>
                  <th>到期時間</th>
                  <th>封鎖時間</th>
                  <th>操作者</th>
                  <th>原因</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {active.map((row) => (
                  <tr key={row.id}>
                    <td title={row.user_id}>{who(row.user_id)}</td>
                    <td>{muteDurationLabel(row.duration_days)}</td>
                    <td>{row.expires_at ? formatHkt(row.expires_at) : '永久'}</td>
                    <td>{formatHkt(row.blocked_at)}</td>
                    <td title={row.blocked_by ?? ''}>{who(row.blocked_by)}</td>
                    <td>{row.reason?.trim() || '—'}</td>
                    <td>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDialog({ type: 'unblock', row })}>
                        解鎖
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <div className="panel">
        <h2>操作紀錄</h2>
        {!loading && rows.length === 0 ? <p className="muted">尚無封鎖或解鎖紀錄。</p> : null}
        {rows.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>用戶</th>
                  <th>狀態</th>
                  <th>禁言時長</th>
                  <th>到期時間</th>
                  <th>封鎖時間</th>
                  <th>封鎖者／原因</th>
                  <th>解鎖時間</th>
                  <th>解鎖者／原因</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td title={row.user_id}>{who(row.user_id)}</td>
                    <td>{statusPill(row)}</td>
                    <td>{muteDurationLabel(row.duration_days)}</td>
                    <td>{row.expires_at ? formatHkt(row.expires_at) : '永久'}</td>
                    <td>{formatHkt(row.blocked_at)}</td>
                    <td>
                      {who(row.blocked_by)}
                      {row.reason?.trim() ? ` · ${row.reason.trim()}` : ''}
                    </td>
                    <td>{formatHkt(row.unblocked_at)}</td>
                    <td>{liftedCell(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        open={dialog?.type === 'block'}
        title="確認封鎖帳戶"
        message={
          dialog?.type === 'block'
            ? blockConfirmCopy({ durationDays: dialog.durationDays, userId: dialog.userId })
            : ''
        }
        confirmLabel="確認封鎖"
        danger
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.type !== 'block' || !user) return;
          void run(() => blockAccount(dialog.userId, dialog.reason, user.id, dialog.durationDays));
        }}
      />

      <ConfirmDialog
        open={dialog?.type === 'unblock'}
        title="確認解鎖帳戶"
        message={
          dialog?.type === 'unblock'
            ? `確認解鎖此帳戶？解鎖後對方可再次參與命運酒館。\n用戶 ID：${dialog.row.user_id}`
            : ''
        }
        confirmLabel="確認解鎖"
        reasonLabel="解鎖備註"
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={(unblockReason) => {
          if (dialog?.type !== 'unblock' || !user) return;
          void run(() => unblockAccount(dialog.row.id, user.id, unblockReason));
        }}
      />
    </section>
  );
}
