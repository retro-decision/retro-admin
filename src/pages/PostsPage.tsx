import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { ConfirmDialog } from '../components/ConfirmDialog';
import {
  AdminApiError,
  adminDeleteHelpComment,
  adminDeleteHelpPost,
  blockAccount,
  fetchPostWithComments,
  fetchProfiles,
  listPostsForAdmin,
  publicImageUrl,
  type AdminHelpComment,
  type AdminHelpPostDetail,
  type AdminHelpPostListItem,
  type HelpPostStatus,
  type LanguageZone,
} from '../lib/api';
import {
  LANGUAGE_ZONES,
  LANGUAGE_ZONE_LABELS,
  displayName,
  formatHkt,
  previewText,
  shortId,
  statusLabel,
  zoneLabel,
} from '../lib/format';

const PAGE_SIZE = 40;

type DialogKind =
  | { type: 'delete-post'; post: AdminHelpPostListItem }
  | { type: 'block-author'; userId: string }
  | { type: 'delete-comment'; comment: AdminHelpComment; replyCount: number }
  | { type: 'block-commenter'; userId: string }
  | null;

function CopyableId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="id-row">
      <span className="mono" title={id}>
        {shortId(id)}
      </span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={(e) => {
          e.stopPropagation();
          void navigator.clipboard.writeText(id).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            },
            () => undefined,
          );
        }}
      >
        {copied ? '已複製' : '複製 ID'}
      </button>
    </span>
  );
}

function PersonLine({
  userId,
  name,
}: {
  userId: string;
  name: string | null | undefined;
}) {
  return (
    <span className="id-row" title={userId}>
      {displayName(name, userId)}
      <CopyableId id={userId} />
    </span>
  );
}

type ThreadItem = {
  comment: AdminHelpComment;
  parent: AdminHelpComment | null;
  depth: number;
  missingParent: boolean;
};

function threadComments(comments: AdminHelpComment[]): ThreadItem[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const children = new Map<string, AdminHelpComment[]>();
  const roots: AdminHelpComment[] = [];
  for (const c of comments) {
    if (c.parent_id && byId.has(c.parent_id)) {
      const list = children.get(c.parent_id) ?? [];
      list.push(c);
      children.set(c.parent_id, list);
    } else {
      roots.push(c);
    }
  }
  roots.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const out: ThreadItem[] = [];
  const walk = (c: AdminHelpComment, depth: number, parent: AdminHelpComment | null) => {
    out.push({
      comment: c,
      parent,
      depth,
      missingParent: Boolean(c.parent_id && !parent),
    });
    const kids = [...(children.get(c.id) ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const k of kids) walk(k, depth + 1, c);
  };
  for (const r of roots) walk(r, 0, r.parent_id ? (byId.get(r.parent_id) ?? null) : null);
  return out;
}

function replyCountFor(comments: AdminHelpComment[], id: string): number {
  return comments.filter((c) => c.parent_id === id).length;
}

export function PostsPage() {
  const { user } = useAuth();
  const [queryInput, setQueryInput] = useState('');
  const [query, setQuery] = useState('');
  const [zone, setZone] = useState<LanguageZone | 'all'>('all');
  const [status, setStatus] = useState<HelpPostStatus | 'all'>('all');
  const [items, setItems] = useState<AdminHelpPostListItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [names, setNames] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminHelpPostDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [busy, setBusy] = useState(false);

  const applySearch = (event?: FormEvent) => {
    event?.preventDefault();
    setQuery(queryInput.trim());
  };

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listPostsForAdmin({
        q: query,
        languageZone: zone,
        status,
        limit: PAGE_SIZE,
        offset: 0,
      });
      setItems(result.items);
      setHasMore(result.hasMore);
      setTotal(result.total);
      const fresh = await fetchProfiles(result.items.map((p) => p.author_id));
      setNames((cur) => ({ ...cur, ...fresh }));
    } catch (e) {
      setItems([]);
      setHasMore(false);
      setTotal(0);
      setError(e instanceof AdminApiError ? e.message : '無法載入帖文列表。');
    } finally {
      setLoading(false);
    }
  }, [query, zone, status]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  useEffect(() => {
    setSelectedId(null);
  }, [query, zone, status]);

  const loadMore = useCallback(async () => {
    setLoadingMore(true);
    setError(null);
    try {
      const result = await listPostsForAdmin({
        q: query,
        languageZone: zone,
        status,
        limit: PAGE_SIZE,
        offset: items.length,
      });
      const next = [...items, ...result.items];
      setItems(next);
      setHasMore(result.hasMore);
      setTotal(result.total);
      const fresh = await fetchProfiles(result.items.map((p) => p.author_id));
      setNames((cur) => ({ ...cur, ...fresh }));
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : '無法載入更多帖文。');
    } finally {
      setLoadingMore(false);
    }
  }, [items, query, zone, status]);

  const selectedListItem = useMemo(
    () => items.find((p) => p.id === selectedId) ?? items[0] ?? null,
    [items, selectedId],
  );

  const activeId = selectedId ?? selectedListItem?.id ?? null;

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void (async () => {
      try {
        const post = await fetchPostWithComments(activeId);
        if (cancelled) return;
        setDetail(post);
        if (post) {
          const ids = [post.author_id, ...post.comments.map((c) => c.author_id)];
          const fresh = await fetchProfiles(ids);
          if (!cancelled) setNames((cur) => ({ ...cur, ...fresh }));
        }
      } catch (e) {
        if (cancelled) return;
        setDetail(null);
        setError(e instanceof AdminApiError ? e.message : '無法載入帖文詳情。');
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  async function run(action: () => Promise<void>) {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      setDialog(null);
      await loadFirstPage();
      if (activeId) {
        const post = await fetchPostWithComments(activeId);
        setDetail(post);
        if (post) {
          const ids = [post.author_id, ...post.comments.map((c) => c.author_id)];
          const fresh = await fetchProfiles(ids);
          setNames((cur) => ({ ...cur, ...fresh }));
        } else if (selectedId === activeId) {
          setSelectedId(null);
        }
      }
    } catch (e) {
      setError(e instanceof AdminApiError ? e.message : '操作失敗。');
    } finally {
      setBusy(false);
    }
  }

  const threaded = useMemo(() => (detail ? threadComments(detail.comments) : []), [detail]);

  function confirmDialog() {
    if (!dialog || !user) return null;
    if (dialog.type === 'delete-post') {
      return (
        <ConfirmDialog
          open
          title="永久刪除帖文"
          message="這會永久刪除該帖文，並一併刪除選項、投票、留言、乾杯、追蹤與相關檢舉。此操作無法還原。"
          confirmLabel="永久刪除"
          danger
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => void run(() => adminDeleteHelpPost(dialog.post.id))}
        />
      );
    }
    if (dialog.type === 'delete-comment') {
      const extra =
        dialog.replyCount > 0
          ? `這則留言目前有 ${dialog.replyCount} 則回覆，回覆會保留並變成獨立留言（原留言不再顯示）。`
          : '若之後有人回覆，回覆會保留並變成獨立留言。';
      return (
        <ConfirmDialog
          open
          title="刪除留言"
          message={`只會刪除這則留言，不會刪除帖文。${extra}\n此操作無法還原。`}
          confirmLabel="刪除留言"
          danger
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => void run(() => adminDeleteHelpComment(dialog.comment.id))}
        />
      );
    }
    const who = dialog.type === 'block-author' ? '作者' : '留言者';
    return (
      <ConfirmDialog
        open
        title={`封鎖${who}`}
        message={`確認封鎖此${who}的酒館權限？封鎖後對方不能再發帖、留言、投票、乾杯、追蹤或檢舉。登入與個人決定／雲端備份不受影響。\n用戶 ID：${dialog.userId}`}
        confirmLabel="確認封鎖"
        danger
        reasonLabel="封鎖原因"
        reasonPlaceholder="例如：重複發布廣告、仇恨言論…"
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={(reason) => void run(() => blockAccount(dialog.userId, reason, user.id))}
      />
    );
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>全部帖文</h1>
          <p className="muted">
            查看命運酒館所有帖文與留言，檢查有否違規。這裡會顯示真實作者與留言者身份，即使帖文匿稱或留言者是發問者亦一樣；此資訊僅管理員可見。
          </p>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => void loadFirstPage()} disabled={loading}>
          重新整理
        </button>
      </div>

      {error ? <p className="banner error">{error}</p> : null}

      <div className="filter-bar">
        <form className="search-field" onSubmit={applySearch}>
          <label className="field">
            <span>搜尋標題或內文</span>
            <span className="search-row">
              <input
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                placeholder="輸入關鍵字"
              />
              <button type="submit" className="btn btn-primary">
                搜尋
              </button>
            </span>
          </label>
        </form>
        <label className="field">
          <span>語言區</span>
          <select value={zone} onChange={(e) => setZone(e.target.value as LanguageZone | 'all')}>
            <option value="all">全部</option>
            {LANGUAGE_ZONES.map((z) => (
              <option key={z} value={z}>
                {LANGUAGE_ZONE_LABELS[z]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>狀態</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as HelpPostStatus | 'all')}>
            <option value="all">全部</option>
            <option value="open">投票中</option>
            <option value="closed">已截止</option>
          </select>
        </label>
      </div>

      <p className="muted list-count">{loading && items.length === 0 ? '載入中…' : `共 ${total} 則帖文`}</p>

      <div className="split">
        <div className="list-pane">
          {!loading && items.length === 0 ? <p className="muted">沒有符合條件的帖文。</p> : null}
          <ul className="report-list">
            {items.map((item) => {
              const active = activeId === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    className={active ? 'report-item active' : 'report-item'}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <div className="report-item-title">{item.title.trim() || '無標題'}</div>
                    {previewText(item.body, 90) ? (
                      <div className="report-item-preview">{previewText(item.body, 90)}</div>
                    ) : null}
                    <div className="report-item-meta">
                      {zoneLabel(item.language_zone)} · {statusLabel(item.status)} · {formatHkt(item.created_at)} · 留言 {item.comment_count}
                    </div>
                    <div className="report-item-meta">
                      {displayName(names[item.author_id], item.author_id)}
                      <span className="mono"> {shortId(item.author_id)}</span>
                      {item.is_anonymous ? ' · 匿稱帖文' : ''}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
          {hasMore ? (
            <button
              type="button"
              className="btn btn-ghost btn-block load-more"
              onClick={() => void loadMore()}
              disabled={loadingMore}
            >
              {loadingMore ? '載入中…' : '載入更多'}
            </button>
          ) : null}
        </div>

        <div className="detail-pane">
          {!selectedListItem ? (
            <p className="muted">選擇一則帖文以查看詳情與留言。</p>
          ) : detailLoading && (!detail || detail.id !== activeId) ? (
            <p className="muted">載入中…</p>
          ) : !detail ? (
            <p className="muted">找不到這則帖文（可能已被刪除）。</p>
          ) : (
            <article className="detail-card">
              <header className="detail-head">
                <h2>{detail.title.trim() || '無標題'}</h2>
                <span className={detail.status === 'open' ? 'pill ok' : 'pill warn'}>
                  {statusLabel(detail.status)}
                </span>
              </header>

              <p className="identity-note">
                以下為管理員專用身份資料：會顯示真實顯示名稱與用戶 ID，即使對方以匿稱發文，或留言者是發問者本人。請用此 ID 封鎖正確的人。
              </p>

              <dl className="meta-grid">
                <div>
                  <dt>作者（真實身份）</dt>
                  <dd>
                    <PersonLine userId={detail.author_id} name={names[detail.author_id]} />
                    {detail.is_anonymous ? <span className="pill warn">匿稱帖文</span> : null}
                  </dd>
                </div>
                <div>
                  <dt>語言區</dt>
                  <dd>{zoneLabel(detail.language_zone)}</dd>
                </div>
                <div>
                  <dt>發佈時間</dt>
                  <dd>{formatHkt(detail.created_at)}</dd>
                </div>
                <div>
                  <dt>截止時間</dt>
                  <dd>{formatHkt(detail.deadline_at)}</dd>
                </div>
                <div>
                  <dt>留言</dt>
                  <dd>{detail.comment_count}</dd>
                </div>
                <div>
                  <dt>總票數</dt>
                  <dd>{detail.vote_count}</dd>
                </div>
              </dl>

              <div className="block">
                <h3>帖文內容</h3>
                <p className="pre">{detail.body.trim() || '（無內文）'}</p>
                {detail.image_paths.length > 0 ? (
                  <div className="thumbs">
                    {detail.image_paths.map((path) => (
                      <a key={path} href={publicImageUrl(path)} target="_blank" rel="noreferrer">
                        <img src={publicImageUrl(path)} alt="帖文圖片" />
                      </a>
                    ))}
                  </div>
                ) : null}
                <p className="muted mono">帖文 ID：{detail.id}</p>
              </div>

              {detail.options.length > 0 ? (
                <div className="block">
                  <h3>投票選項</h3>
                  <ul className="option-list">
                    {detail.options.map((opt) => (
                      <li key={opt.id}>
                        <span>{opt.label}</span>
                        <span className="muted">
                          {opt.vote_count} 票
                          {detail.final_option_id === opt.id ? ' · 最終選擇' : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="actions">
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => setDialog({ type: 'delete-post', post: detail })}
                >
                  永久刪除帖文
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setDialog({ type: 'block-author', userId: detail.author_id })}
                >
                  封鎖作者
                </button>
              </div>

              <div className="block">
                <h3>留言（{detail.comments.length}）</h3>
                {threaded.length === 0 ? <p className="muted">這則帖文尚未有留言。</p> : null}
                <ul className="comment-list">
                  {threaded.map(({ comment, parent, depth, missingParent }) => (
                    <li
                      key={comment.id}
                      className={depth > 0 ? 'comment reply' : 'comment'}
                      style={depth > 1 ? { marginLeft: Math.min(depth, 4) * 18 } : undefined}
                    >
                      <div className="comment-head">
                        <div>
                          <div className="comment-author">
                            <PersonLine userId={comment.author_id} name={names[comment.author_id]} />
                            {comment.author_id === detail.author_id ? (
                              <span className="pill">發問者</span>
                            ) : null}
                          </div>
                          <div className="muted">{formatHkt(comment.created_at)}</div>
                        </div>
                        <div className="comment-actions">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() =>
                              setDialog({
                                type: 'delete-comment',
                                comment,
                                replyCount: replyCountFor(detail.comments, comment.id),
                              })
                            }
                          >
                            刪除留言
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setDialog({ type: 'block-commenter', userId: comment.author_id })}
                          >
                            封鎖留言者
                          </button>
                        </div>
                      </div>
                      {parent ? (
                        <div className="quote-parent">
                          回覆 {displayName(names[parent.author_id], parent.author_id)}：
                          {previewText(parent.body, 60) || '（無內容）'}
                        </div>
                      ) : missingParent ? (
                        <div className="quote-parent">回覆一則已刪除的留言</div>
                      ) : null}
                      <p className="pre">{comment.body.trim() || '（無內容）'}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          )}
        </div>
      </div>
      {confirmDialog()}
    </section>
  );
}
