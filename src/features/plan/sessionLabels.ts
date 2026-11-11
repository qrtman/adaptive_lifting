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

const NUMBER_ALIAS: Record<'Day' | 'Week', RegExp> = {
  Day: /^(?:day|d)?\s*(\d{1,2})$/i,
  Week: /^(?:week|wk|w)?\s*(\d{1,2})$/i,
};

/** "3", "Day 3", "D3", "Week3", "wk 3" → 3. Anything else (e.g. "Deload") → null. */
export function labelNumber(kind: 'Day' | 'Week', raw: string | null | undefined): number | null {
  const match = NUMBER_ALIAS[kind].exec(raw?.trim() ?? '');
  if (!match) return null;
  const value = Number(match[1]);
  return value >= 1 ? value : null;
}

/** "Wed, 18 Nov" (plus the year when it isn't this year). Falls back to the input. */
export function formatSessionDate(iso: string, today: Date = new Date()): string {
  if (!ISO_DATE.test(iso)) return iso;
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const parts = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  const text = `${part('weekday')}, ${part('day')} ${part('month')}`;
  return year === today.getFullYear() ? text : `${text} ${year}`;
}

/** Name is optional. An empty name is stored as `Session` and means "no name". */
export const UNNAMED_SESSION_TITLE = 'Session';

export function isPlaceholderTitle(raw: string | null | undefined): boolean {
  const trimmed = raw?.trim() ?? '';
  return trimmed === '' || trimmed.toLowerCase() === UNNAMED_SESSION_TITLE.toLowerCase();
}

/** What to call a session: its name, else Day · Week, else "Session". */
export function sessionHeadline(session: { title?: string | null; dayLabel?: string | null; weekLabel?: string | null }): string {
  const title = session.title?.trim() ?? '';
  if (!isPlaceholderTitle(title)) return title;
  const slot = [formatPlanLabel('Day', session.dayLabel), formatPlanLabel('Week', session.weekLabel)].filter(Boolean);
  return slot.length ? slot.join(' · ') : UNNAMED_SESSION_TITLE;
}

/** Name suggestions must not include Day-slot strings (`Day 1`, `D1`, `day 1`). Keep `AM` / `Meet`. */
export function isDayLikeTitle(raw: string | null | undefined): boolean {
  const canonical = normalizeDayLabel(raw);
  return canonical != null && /^\d+$/.test(canonical);
}
