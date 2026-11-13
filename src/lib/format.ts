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
