/** Dates are calendar days, so use UTC to avoid daylight-saving gaps. */
function nextDate(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

export type WeekBoardRow<T> =
  | { kind: 'session'; item: T }
  | { kind: 'rest'; date: string };

export function sortByFirstSession<T>(
  weeks: Array<{ weekLabel: string; items: T[] }>,
  dateOf: (item: T) => string,
): Array<{ weekLabel: string; items: T[] }> {
  return weeks
    .map((week) => ({ ...week, items: [...week.items].sort((a, b) => dateOf(a).localeCompare(dateOf(b))) }))
    .sort((a, b) =>
      dateOf(a.items[0]).localeCompare(dateOf(b.items[0])) ||
      a.weekLabel.localeCompare(b.weekLabel),
    );
}

/** Append boundary rest dates to this week, but never after the final week. */
export function weekBoardRows<T>(
  items: T[],
  nextWeekDate: string | undefined,
  dateOf: (item: T) => string,
  occupiedDates: ReadonlySet<string>,
): WeekBoardRow<T>[] {
  const rows: WeekBoardRow<T>[] = [];
  items.forEach((item, index) => {
    const date = dateOf(item);
    rows.push({ kind: 'session', item });
    const followingDate = index + 1 < items.length ? dateOf(items[index + 1]) : nextWeekDate;
    if (!followingDate || followingDate <= date) return;
    for (let restDate = nextDate(date); restDate < followingDate; restDate = nextDate(restDate)) {
      if (!occupiedDates.has(restDate)) rows.push({ kind: 'rest', date: restDate });
    }
  });
  return rows;
}
