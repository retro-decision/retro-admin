import { supabase, HELP_IMAGE_BUCKET } from './supabase';

export class AdminApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'AdminApiError';
    this.code = code;
  }
}

function mapError(err: unknown, fallback = '操作失敗，請稍後再試。'): never {
  const raw = err as { message?: string; code?: string; details?: string };
  const msg = `${raw?.message ?? ''} ${raw?.code ?? ''} ${raw?.details ?? ''}`;
  if (/account_blocks_already_lifted|account_blocks_immutable/i.test(msg)) {
    throw new AdminApiError('already_lifted', '此封鎖紀錄已解鎖或不可更改。');
  }
  if (/account_blocks_one_active|duplicate|unique|23505/i.test(msg)) {
    throw new AdminApiError('already_blocked', '此帳戶已在封鎖名單中。');
  }
  if (/account_blocks_admin_only|42501|not authorized|row-level security|rls/i.test(msg)) {
    throw new AdminApiError('forbidden', '沒有權限執行此操作。');
  }
  if (/foreign key|23503/i.test(msg)) {
    throw new AdminApiError('not_found', '找不到這個用戶（請確認 UUID 是否正確，且該用戶曾登入過）。');
  }
  if (/22P02|invalid input syntax for type uuid/i.test(msg)) {
    throw new AdminApiError('bad_uuid', '請輸入有效的用戶 UUID。');
  }
  if (/PGRST/i.test(msg) && /relation|schema cache|does not exist|42P01/i.test(msg)) {
    throw new AdminApiError(
      'migration_pending',
      '資料庫尚未套用封鎖相關 migration。請先由營運在正式專案執行 supabase/migrations 內的 SQL。',
    );
  }
  throw new AdminApiError('generic', raw?.message?.trim() || fallback);
}

export async function isAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin');
  if (error) return false;
  return data === true;
}

export type HelpReport = {
  id: string;
  reporter_id: string;
  target_post_id: string;
  reason: string;
  note: string | null;
  created_at: string;
  handled_at: string | null;
  handled_by: string | null;
  post_title: string | null;
  post_body: string | null;
  post_author_id: string | null;
  post_status: string | null;
  post_created_at: string | null;
  post_image_paths: string[];
  post_missing: boolean;
};

export type AccountBlock = {
  id: string;
  user_id: string;
  blocked_at: string;
  blocked_by: string | null;
  reason: string | null;
  unblocked_at: string | null;
  unblocked_by: string | null;
  unblock_reason: string | null;
};

export async function fetchProfiles(
  userIds: string[],
): Promise<Record<string, string | null>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return {};
  const { data, error } = await supabase
    .from('tavern_profiles')
    .select('user_id, display_name')
    .in('user_id', ids);
  if (error) return {};
  const map: Record<string, string | null> = {};
  for (const row of data ?? []) {
    map[row.user_id as string] = (row.display_name as string | null) ?? null;
  }
  return map;
}

export async function listReportsForAdmin(opts: {
  unhandledOnly: boolean;
  limit?: number;
}): Promise<HelpReport[]> {
  let q = supabase
    .from('help_reports')
    .select(
      'id, reporter_id, target_post_id, reason, note, created_at, handled_at, handled_by, help_posts(id, title, body, author_id, status, created_at, image_paths)',
    )
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 100);
  if (opts.unhandledOnly) q = q.is('handled_at', null);
  const { data, error } = await q;
  if (error) mapError(error, '無法載入檢舉列表。');
  return (data ?? []).map((raw: Record<string, unknown>) => {
    const post = raw.help_posts as Record<string, unknown> | null;
    const paths = Array.isArray(post?.image_paths)
      ? (post.image_paths as unknown[]).filter((p): p is string => typeof p === 'string' && p.length > 0)
      : [];
    return {
      id: raw.id as string,
      reporter_id: raw.reporter_id as string,
      target_post_id: raw.target_post_id as string,
      reason: raw.reason as string,
      note: (raw.note as string | null) ?? null,
      created_at: raw.created_at as string,
      handled_at: (raw.handled_at as string | null) ?? null,
      handled_by: (raw.handled_by as string | null) ?? null,
      post_title: (post?.title as string | null) ?? null,
      post_body: (post?.body as string | null) ?? null,
      post_author_id: (post?.author_id as string | null) ?? null,
      post_status: (post?.status as string | null) ?? null,
      post_created_at: (post?.created_at as string | null) ?? null,
      post_image_paths: paths,
      post_missing: !post,
    };
  });
}

export async function markReportHandled(reportId: string, adminId: string): Promise<void> {
  const { data, error } = await supabase
    .from('help_reports')
    .update({ handled_at: new Date().toISOString(), handled_by: adminId })
    .eq('id', reportId)
    .select('id');
  if (error) mapError(error, '無法將檢舉標為已處理。');
  if (!data?.length) throw new AdminApiError('generic', '無法將檢舉標為已處理。');
}

export async function adminDeleteHelpPost(postId: string): Promise<void> {
  const { data: row, error: readErr } = await supabase
    .from('help_posts')
    .select('id, image_paths')
    .eq('id', postId)
    .maybeSingle();
  if (readErr) mapError(readErr, '找不到要刪除的帖文。');
  if (!row) throw new AdminApiError('not_found', '帖文不存在或已被刪除。');
  const paths = Array.isArray(row.image_paths)
    ? row.image_paths.filter(
        (p: unknown): p is string => typeof p === 'string' && p.length > 0 && !p.startsWith('data:'),
      )
    : [];
  const { data: deleted, error } = await supabase
    .from('help_posts')
    .delete()
    .eq('id', postId)
    .select('id');
  if (error) mapError(error, '無法刪除帖文。');
  if (!deleted?.length) throw new AdminApiError('generic', '無法刪除帖文。');
  if (paths.length) {
    try {
      await supabase.storage.from(HELP_IMAGE_BUCKET).remove(paths);
    } catch {
      /* post is already gone */
    }
  }
}

export function publicImageUrl(path: string): string {
  const { data } = supabase.storage.from(HELP_IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function listAccountBlocks(): Promise<AccountBlock[]> {
  const { data, error } = await supabase
    .from('account_blocks')
    .select(
      'id, user_id, blocked_at, blocked_by, reason, unblocked_at, unblocked_by, unblock_reason',
    )
    .order('blocked_at', { ascending: false });
  if (error) mapError(error, '無法載入封鎖名單。');
  return (data ?? []) as AccountBlock[];
}

export async function blockAccount(userId: string, reason: string, adminId: string): Promise<void> {
  const trimmed = reason.trim();
  const { error } = await supabase.from('account_blocks').insert({
    user_id: userId.trim(),
    blocked_by: adminId,
    reason: trimmed.length ? trimmed : null,
  });
  if (error) mapError(error, '無法封鎖此帳戶。');
}

export async function unblockAccount(
  blockId: string,
  adminId: string,
  unblockReason: string,
): Promise<void> {
  const trimmed = unblockReason.trim();
  const { data, error } = await supabase
    .from('account_blocks')
    .update({
      unblocked_at: new Date().toISOString(),
      unblocked_by: adminId,
      unblock_reason: trimmed.length ? trimmed : null,
    })
    .eq('id', blockId)
    .is('unblocked_at', null)
    .select('id');
  if (error) mapError(error, '無法解鎖此帳戶。');
  if (!data?.length) throw new AdminApiError('generic', '無法解鎖此帳戶（可能已解鎖）。');
}

export const LANGUAGE_ZONES = ['zh', 'en', 'ja', 'ko', 'intl'] as const;
export type LanguageZone = (typeof LANGUAGE_ZONES)[number];
export type HelpPostStatus = 'open' | 'closed';

export type AdminHelpPostListItem = {
  id: string;
  author_id: string;
  title: string;
  body: string;
  category: string;
  is_anonymous: boolean;
  status: string;
  language_zone: string;
  vote_count: number;
  created_at: string;
  updated_at: string;
  image_paths: string[];
  comment_count: number;
};

export type AdminHelpOption = {
  id: string;
  post_id: string;
  label: string;
  tag: string | null;
  sort_order: number;
  vote_count: number;
};

export type AdminHelpComment = {
  id: string;
  post_id: string;
  author_id: string;
  body: string;
  parent_id: string | null;
  created_at: string;
};

export type AdminHelpPostDetail = AdminHelpPostListItem & {
  deadline_at: string | null;
  closed_at: string | null;
  final_option_id: string | null;
  options: AdminHelpOption[];
  comments: AdminHelpComment[];
};

const POST_LIST_FIELDS =
  'id, author_id, title, body, category, is_anonymous, status, language_zone, vote_count, created_at, updated_at, image_paths, help_comments(count)';

function parseImagePaths(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : [];
}

function commentCountFromEmbed(raw: unknown): number {
  if (Array.isArray(raw) && raw[0] && typeof raw[0] === 'object' && raw[0] !== null && 'count' in raw[0]) {
    const n = Number((raw[0] as { count: unknown }).count);
    return Number.isFinite(n) ? n : 0;
  }
  if (raw && typeof raw === 'object' && 'count' in raw) {
    const n = Number((raw as { count: unknown }).count);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function mapPostListRow(raw: Record<string, unknown>): AdminHelpPostListItem {
  return {
    id: raw.id as string,
    author_id: raw.author_id as string,
    title: (raw.title as string) ?? '',
    body: (raw.body as string) ?? '',
    category: (raw.category as string) ?? '',
    is_anonymous: Boolean(raw.is_anonymous),
    status: (raw.status as string) ?? '',
    language_zone: (raw.language_zone as string) ?? '',
    vote_count: Number(raw.vote_count ?? 0),
    created_at: raw.created_at as string,
    updated_at: raw.updated_at as string,
    image_paths: parseImagePaths(raw.image_paths),
    comment_count: commentCountFromEmbed(raw.help_comments),
  };
}

/** Escape a user search string for use inside a quoted PostgREST ilike value. */
function escapeIlikeOrValue(raw: string): string {
  return raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/"/g, '\\"');
}

export async function listPostsForAdmin(opts: {
  q?: string;
  languageZone?: LanguageZone | 'all';
  status?: HelpPostStatus | 'all';
  limit?: number;
  offset?: number;
}): Promise<{ items: AdminHelpPostListItem[]; hasMore: boolean; total: number }> {
  const limit = opts.limit ?? 40;
  const offset = opts.offset ?? 0;
  let q = supabase
    .from('help_posts')
    .select(POST_LIST_FIELDS, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  const zone = opts.languageZone;
  if (zone && zone !== 'all') q = q.eq('language_zone', zone);
  const status = opts.status;
  if (status && status !== 'all') q = q.eq('status', status);
  const needle = opts.q?.trim();
  if (needle) {
    const pattern = `%${escapeIlikeOrValue(needle)}%`;
    q = q.or(`title.ilike."${pattern}",body.ilike."${pattern}"`);
  }
  const { data, error, count } = await q;
  if (error) mapError(error, '無法載入帖文列表。');
  const items = (data ?? []).map((row) => mapPostListRow(row as Record<string, unknown>));
  const total = count ?? items.length + offset;
  return { items, hasMore: offset + items.length < total, total };
}

export async function fetchPostWithComments(postId: string): Promise<AdminHelpPostDetail | null> {
  const { data: post, error: postErr } = await supabase
    .from('help_posts')
    .select(
      'id, author_id, title, body, category, is_anonymous, status, language_zone, vote_count, created_at, updated_at, image_paths, deadline_at, closed_at, final_option_id',
    )
    .eq('id', postId)
    .maybeSingle();
  if (postErr) mapError(postErr, '無法載入帖文。');
  if (!post) return null;

  const [optionsRes, comments] = await Promise.all([
    supabase
      .from('help_options')
      .select('id, post_id, label, tag, sort_order, vote_count')
      .eq('post_id', postId)
      .order('sort_order', { ascending: true }),
    fetchAllCommentsForPost(postId),
  ]);
  if (optionsRes.error) mapError(optionsRes.error, '無法載入投票選項。');

  const list = mapPostListRow(post as Record<string, unknown>);
  return {
    ...list,
    comment_count: comments.length,
    deadline_at: (post.deadline_at as string | null) ?? null,
    closed_at: (post.closed_at as string | null) ?? null,
    final_option_id: (post.final_option_id as string | null) ?? null,
    options: (optionsRes.data ?? []) as AdminHelpOption[],
    comments,
  };
}

async function fetchAllCommentsForPost(postId: string): Promise<AdminHelpComment[]> {
  const pageSize = 1000;
  const all: AdminHelpComment[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('help_comments')
      .select('id, post_id, author_id, body, parent_id, created_at')
      .eq('post_id', postId)
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) mapError(error, '無法載入留言。');
    const rows = (data ?? []) as AdminHelpComment[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export async function adminDeleteHelpComment(commentId: string): Promise<void> {
  const { data, error } = await supabase
    .from('help_comments')
    .delete()
    .eq('id', commentId)
    .select('id');
  if (error) mapError(error, '無法刪除留言。');
  if (!data?.length) throw new AdminApiError('not_found', '留言不存在或已被刪除。');
}
