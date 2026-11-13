import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  AdminApiError,
  adminDeleteHelpPost,
  blockAccount,
  fetchProfiles,
  listReportsForAdmin,
  markReportHandled,
  publicImageUrl,
  type HelpReport,
} from '../lib/api';
import { displayName, formatHkt, reasonLabel, shortId } from '../lib/format';

type DialogKind =
  | { type: 'handled'; report: HelpReport }
  | { type: 'delete'; report: HelpReport }
  | { type: 'block-author'; report: HelpReport }
  | { type: 'block-reporter'; report: HelpReport }
  | null;

export function ReportsPage() {
  const { user } = useAuth();
  const [unhandledOnly, setUnhandledOnly] = useState(true);
  const [items, setItems] = useState<HelpReport[]>([]);
  const [names, setNames] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listReportsForAdmin({ unhandledOnly, limit: 200 });
      setItems(list);
      const ids = list.flatMap((r) => [r.reporter_id, r.post_author_id, r.handled_by]).filter((id): id is string => !!id);
      setNames(await fetchProfiles(ids));
    } catch (e) {
      setItems([]);
      setError(e instanceof AdminApiError ? e.message : '無法載入檢舉列表。');
    } finally {
      setLoading(false);
    }
  }, [unhandledOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => items.find((r) => r.id === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  );

  async function run(action: () => Promise<void>) {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      setDialog(null);
      await load();
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : '操作失敗。');
    } finally {
      setBusy(false);
    }
  }

  function confirmDialog() {
    if (!dialog || !user) return null;
    if (dialog.type === 'handled') {
      return (
        <ConfirmDialog
          open
          title="標為已處理"
          message="確認將這則檢舉標為已處理？帖文本身不會被刪除。"
          confirmLabel="標為已處理"
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => void run(() => markReportHandled(dialog.report.id, user.id))}
        />
      );
    }
    if (dialog.type === 'delete') {
      return (
        <ConfirmDialog
          open
          title="永久刪除帖文"
          message="這會永久刪除該帖文，並一併刪除選項、投票、留言、乾杯、追蹤與相關檢舉。此操作無法還原。"
          confirmLabel="永久刪除"
          danger
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => void run(() => adminDeleteHelpPost(dialog.report.target_post_id))}
        />
      );
    }
    const targetId = dialog.type === 'block-author' ? dialog.report.post_author_id : dialog.report.reporter_id;
    const who = dialog.type === 'block-author' ? '作者' : '檢舉人';
    return (
      <ConfirmDialog
        open
        title={`封鎖${who}`}
        message={`確認封鎖此${who}的酒館權限？封鎖後對方不能再發帖、留言、投票、乾杯、追蹤或檢舉。登入與個人決定／雲端備份不受影響。${targetId ? `\n用戶 ID：${targetId}` : ''}`}
        confirmLabel="確認封鎖"
        danger
        reasonLabel="封鎖原因"
        reasonPlaceholder="例如：重複發布廣告、仇恨言論…"
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={(reason) => {
          if (!targetId) return;
          void run(() => blockAccount(targetId, reason, user.id));
        }}
      />
    );
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>檢舉列表</h1>
          <p className="muted">處理命運酒館檢舉、刪除違規帖文，或由此封鎖相關帳戶。</p>
        </div>
        <div className="toolbar">
          <div className="segmented" role="tablist">
            <button
              type="button"
              className={unhandledOnly ? 'seg on' : 'seg'}
              onClick={() => setUnhandledOnly(true)}
            >
              未處理
            </button>
            <button
              type="button"
              className={!unhandledOnly ? 'seg on' : 'seg'}
              onClick={() => setUnhandledOnly(false)}
            >
              全部
            </button>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}>
            重新整理
          </button>
        </div>
      </div>

      {error ? <p className="banner error">{error}</p> : null}

      <div className="split">
        <div className="list-pane">
          {loading && items.length === 0 ? <p className="muted">載入中…</p> : null}
          {!loading && items.length === 0 ? <p className="muted">目前沒有檢舉。</p> : null}
          <ul className="report-list">
            {items.map((item) => {
              const active = selected?.id === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={active ? 'report-item active' : 'report-item'}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <div className="report-item-title">
                      {item.post_title?.trim() || (item.post_missing ? '（帖文已不存在）' : shortId(item.target_post_id))}
                    </div>
                    <div className="report-item-meta">
                      {formatHkt(item.created_at)} · {reasonLabel(item.reason)} ·{' '}
                      {item.handled_at ? '已處理' : '未處理'}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="detail-pane">
          {!selected ? (
            <p className="muted">選擇一則檢舉以查看詳情。</p>
          ) : (
            <article className="detail-card">
              <header className="detail-head">
                <h2>{selected.post_title?.trim() || '無標題'}</h2>
                <span className={selected.handled_at ? 'pill ok' : 'pill warn'}>
                  {selected.handled_at ? '已處理' : '未處理'}
                </span>
              </header>

              <dl className="meta-grid">
                <div>
                  <dt>檢舉時間</dt>
                  <dd>{formatHkt(selected.created_at)}</dd>
                </div>
                <div>
                  <dt>原因</dt>
                  <dd>{reasonLabel(selected.reason)}</dd>
                </div>
                <div>
                  <dt>檢舉人</dt>
                  <dd title={selected.reporter_id}>
                    {displayName(names[selected.reporter_id], selected.reporter_id)}
                    <span className="mono"> {shortId(selected.reporter_id)}</span>
                  </dd>
                </div>
                <div>
                  <dt>作者</dt>
                  <dd title={selected.post_author_id ?? ''}>
                    {selected.post_author_id
                      ? `${displayName(names[selected.post_author_id], selected.post_author_id)} ${shortId(selected.post_author_id)}`
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>帖文狀態</dt>
                  <dd>{selected.post_missing ? '已刪除或不存在' : selected.post_status ?? '—'}</dd>
                </div>
                <div>
                  <dt>帖文時間</dt>
                  <dd>{formatHkt(selected.post_created_at)}</dd>
                </div>
                {selected.handled_at ? (
                  <div>
                    <dt>處理時間</dt>
                    <dd>{formatHkt(selected.handled_at)}</dd>
                  </div>
                ) : null}
              </dl>

              {selected.note ? (
                <div className="block">
                  <h3>檢舉備註</h3>
                  <p className="pre">{selected.note}</p>
                </div>
              ) : null}

              <div className="block">
                <h3>帖文內容</h3>
                {selected.post_missing ? (
                  <p className="muted">帖文已不存在（可能已被刪除）。</p>
                ) : (
                  <p className="pre">{selected.post_body?.trim() || '（無內文）'}</p>
                )}
                {selected.post_image_paths.length > 0 ? (
                  <div className="thumbs">
                    {selected.post_image_paths.map((path) => (
                      <a key={path} href={publicImageUrl(path)} target="_blank" rel="noreferrer">
                        <img src={publicImageUrl(path)} alt="帖文圖片" />
                      </a>
                    ))}
                  </div>
                ) : null}
                <p className="muted mono">帖文 ID：{selected.target_post_id}</p>
              </div>

              <div className="actions">
                {!selected.handled_at ? (
                  <button type="button" className="btn btn-primary" onClick={() => setDialog({ type: 'handled', report: selected })}>
                    標為已處理
                  </button>
                ) : null}
                {!selected.post_missing ? (
                  <button type="button" className="btn btn-danger" onClick={() => setDialog({ type: 'delete', report: selected })}>
                    永久刪除帖文
                  </button>
                ) : null}
                {selected.post_author_id ? (
                  <button type="button" className="btn btn-ghost" onClick={() => setDialog({ type: 'block-author', report: selected })}>
                    封鎖作者
                  </button>
                ) : null}
                <button type="button" className="btn btn-ghost" onClick={() => setDialog({ type: 'block-reporter', report: selected })}>
                  封鎖檢舉人
                </button>
              </div>
            </article>
          )}
        </div>
      </div>
      {confirmDialog()}
    </section>
  );
}
