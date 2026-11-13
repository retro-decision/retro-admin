export const REPORT_REASONS = {
  spam: '垃圾訊息',
  hate: '仇恨',
  sexual: '色情',
  harassment: '騷擾',
  misinfo: '不實資訊',
  other: '其他',
} as const;

export type ReportReason = keyof typeof REPORT_REASONS;

export function reasonLabel(reason: string): string {
  return REPORT_REASONS[reason as ReportReason] ?? reason;
}

export const LANGUAGE_ZONES = ['zh', 'en', 'ja', 'ko', 'intl'] as const;
export type LanguageZone = (typeof LANGUAGE_ZONES)[number];

export const LANGUAGE_ZONE_LABELS: Record<LanguageZone, string> = {
  zh: '中文',
  en: '英文',
  ja: '日文',
  ko: '韓文',
  intl: '國際',
};

export function zoneLabel(zone: string | null | undefined): string {
  if (!zone) return '—';
  return LANGUAGE_ZONE_LABELS[zone as LanguageZone] ?? zone;
}

export function isLanguageZone(value: string): value is LanguageZone {
  return (LANGUAGE_ZONES as readonly string[]).includes(value);
}

export function statusLabel(status: string | null | undefined): string {
  if (status === 'open') return '投票中';
  if (status === 'closed') return '已截止';
  return status?.trim() || '—';
}

export function previewText(text: string | null | undefined, max = 80): string {
  const t = text?.replace(/\s+/g, ' ').trim() ?? '';
  if (!t) return '';
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function formatHkt(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

export function shortId(id: string | null | undefined, len = 8): string {
  if (!id) return '—';
  return id.slice(0, len);
}

export function displayName(name: string | null | undefined, userId: string): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : shortId(userId);
}

export const MUTE_DURATION_DAYS = [1, 3, 7, 10, 30, 90, 365] as const;
export type MuteDurationDays = (typeof MUTE_DURATION_DAYS)[number] | null;

export const MUTE_DURATION_OPTIONS: { value: MuteDurationDays; label: string }[] = [
  ...MUTE_DURATION_DAYS.map((days) => ({ value: days as MuteDurationDays, label: `${days}天` })),
  { value: null, label: '永久' },
];

export function isMuteDurationDays(value: number | null): value is MuteDurationDays {
  return value === null || (MUTE_DURATION_DAYS as readonly number[]).includes(value);
}

export function muteDurationLabel(days: number | null | undefined): string {
  if (days == null) return '永久';
  return `${days}天`;
}

export type BlockStatus = 'active' | 'expired' | 'lifted';

export function blockStatus(row: {
  unblocked_at: string | null;
  unblocked_by?: string | null;
  unblock_reason?: string | null;
  expires_at: string | null;
}): BlockStatus {
  if (row.unblocked_at) {
    return row.unblock_reason === 'expired' && !row.unblocked_by ? 'expired' : 'lifted';
  }
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) return 'expired';
  return 'active';
}

export function blockStatusLabel(status: BlockStatus): string {
  if (status === 'expired') return '已到期';
  if (status === 'lifted') return '已解鎖';
  return '封鎖中';
}

export function isBlockActive(row: {
  unblocked_at: string | null;
  expires_at: string | null;
}): boolean {
  return blockStatus(row) === 'active';
}

export function blockConfirmCopy(opts: {
  who?: string;
  durationDays: MuteDurationDays;
  userId?: string | null;
}): string {
  const who = opts.who ?? '帳戶';
  const dur = muteDurationLabel(opts.durationDays);
  const head =
    opts.durationDays == null
      ? `確認永久封鎖此${who}的酒館權限？對方將不能再發帖、留言、投票、乾杯、追蹤或檢舉。登入與個人決定／雲端備份不受影響。`
      : `確認封鎖此${who}的酒館權限 ${dur}？期間內對方不能發帖、留言、投票、乾杯、追蹤或檢舉。到期後會自動解除。登入與個人決定／雲端備份不受影響。`;
  return opts.userId ? `${head}\n用戶 ID：${opts.userId}` : head;
}
