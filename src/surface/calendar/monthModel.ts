export type WeekStart = 0 | 1;

export type MonthDay = {
  iso: string;
  dayNumber: number;
  inMonth: boolean;
  row: number;
  col: number;
};

const WEEKDAY_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const WEEKDAY_SUN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function toIso(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

export function parseIso(iso: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) };
}

export function weekdayHeaders(weekStartsOn: WeekStart): readonly string[] {
  return weekStartsOn === 0 ? WEEKDAY_SUN : WEEKDAY_MON;
}

export function startOffset(year: number, monthIndex: number, weekStartsOn: WeekStart): number {
  const raw = new Date(year, monthIndex, 1).getDay();
  if (weekStartsOn === 1) return (raw + 6) % 7;
  return raw;
}

export function buildMonthGrid(year: number, monthIndex: number, weekStartsOn: WeekStart = 1): MonthDay[] {
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const offset = startOffset(year, monthIndex, weekStartsOn);
  const prevDays = new Date(year, monthIndex, 0).getDate();
  const prevMonth = monthIndex === 0 ? 11 : monthIndex - 1;
  const prevYear = monthIndex === 0 ? year - 1 : year;
  const nextMonth = monthIndex === 11 ? 0 : monthIndex + 1;
  const nextYear = monthIndex === 11 ? year + 1 : year;

  const days: MonthDay[] = [];
  for (let i = offset - 1; i >= 0; i -= 1) {
    const d = prevDays - i;
    days.push({ iso: toIso(prevYear, prevMonth, d), dayNumber: d, inMonth: false, row: 0, col: 0 });
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    days.push({ iso: toIso(year, monthIndex, d), dayNumber: d, inMonth: true, row: 0, col: 0 });
  }
  const pad = days.length % 7 === 0 ? 0 : 7 - (days.length % 7);
  for (let d = 1; d <= pad; d += 1) {
    days.push({ iso: toIso(nextYear, nextMonth, d), dayNumber: d, inMonth: false, row: 0, col: 0 });
  }
  return days.map((day, index) => ({
    ...day,
    row: Math.floor(index / 7) + 1,
    col: (index % 7) + 1,
  }));
}

export function shiftMonth(year: number, monthIndex: number, delta: number): { year: number; month: number } {
  const date = new Date(year, monthIndex + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

export function moveFocus(iso: string, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown', days: MonthDay[]): string {
  const index = days.findIndex((day) => day.iso === iso);
  if (index < 0) return iso;
  const delta = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -7 : 7;
  const next = days[index + delta];
  return next ? next.iso : iso;
}

export function todayIso(now: Date = new Date()): string {
  return toIso(now.getFullYear(), now.getMonth(), now.getDate());
}

export function weekStripDays(days: MonthDay[], focusedIso: string): MonthDay[] {
  const index = Math.max(0, days.findIndex((day) => day.iso === focusedIso));
  const start = index - (index % 7);
  return days.slice(start, start + 7);
}
