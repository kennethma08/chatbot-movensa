export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function dateKey(value: string | null | undefined): string | null {
  const date = parseDate(value);
  if (!date) return null;
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function formatDate(
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
  fallback = '—',
): string {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat('es-GT', options).format(date) : fallback;
}
