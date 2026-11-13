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
