/** Display labels for the session header. Stored values may be "1", "Week1", or "Hypertrophy". */

export type PlanLabelKind = 'Block' | 'Week' | 'Day';

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const DAY_ALIAS = /^(?:day\s*|d)?(\d+)$/i;

export function isUnlabeledDay(raw: string | null | undefined): boolean {
  const trimmed = raw?.trim() ?? '';
  return trimmed === '' || ISO_DATE.test(trimmed);
}

/** Canonical slot: "1"…"7" for Day aliases; custom tokens kept; ISO/empty → null (unlabeled). */
export function normalizeDayLabel(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed || ISO_DATE.test(trimmed)) return null;
  const aliased = DAY_ALIAS.exec(trimmed);
  if (aliased) return String(Number(aliased[1]));
  return trimmed;
}

export function formatPlanLabel(kind: PlanLabelKind, raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (kind === 'Day') {
    const canonical = normalizeDayLabel(trimmed);
    if (!canonical) return null;
    if (/^\d+$/.test(canonical)) return `Day ${canonical}`;
    return canonical;
  }
  const stripped = trimmed.replace(new RegExp(`^${kind}\\s*`, 'i'), '').trim();
  if (!stripped) return kind;
  return `${kind} ${stripped}`;
}

export function displayDayField(raw: string | null | undefined): string {
  return formatPlanLabel('Day', raw) ?? '';
}
