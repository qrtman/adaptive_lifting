export type CopyGrain = 'day' | 'week' | 'block';
export type CopyMode = 'lifts' | 'plan' | 'logs';

export type CopySourceSession = {
  id: string;
  date: string;
  title?: string;
  blockLabel?: string | null;
  weekLabel?: string | null;
};

export type CopyClipboard = {
  grain: CopyGrain;
  sessionIds: string[];
  sourceDates: Record<string, string>;
  titles: Record<string, string>;
  sourceBlocks: Record<string, string>;
  preserveWeekLabel: boolean;
  /** Omit when mixed labeled blocks so each clone keeps its source. */
  targetBlockLabel?: string;
};

export type CopyWeekPayload = {
  sessionIds: string[];
  athleteId?: string;
  dateOffsetDays: number;
  copyMode: CopyMode;
  preserveWeekLabel: boolean;
  targetBlockLabel?: string;
};

export function labeledValue(value: string | null | undefined): string {
  return (value || '').trim();
}

export function minSourceDate(dates: string[]): string | null {
  const sorted = dates.filter(Boolean).slice().sort();
  return sorted[0] ?? null;
}

export function dateOffsetDays(destD1: string, minSource: string): number {
  const start = new Date(`${minSource}T00:00:00`);
  const end = new Date(`${destD1}T00:00:00`);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
}

export function clipboardMinDate(clip: CopyClipboard): string | null {
  return minSourceDate(clip.sessionIds.map((id) => clip.sourceDates[id]));
}

/** Day grain: shared labeled block, or recent block when every source is unlabeled. Mixed labeled blocks omit. */
export function resolveDayTargetBlock(
  sources: CopySourceSession[],
  recentBlock: string,
): string | undefined {
  const blocks = sources.map((source) => labeledValue(source.blockLabel));
  const uniqueLabeled = [...new Set(blocks.filter(Boolean))];
  if (uniqueLabeled.length === 0) {
    const recent = labeledValue(recentBlock);
    return recent || undefined;
  }
  const allShareOne = uniqueLabeled.length === 1 && blocks.every((block) => block === uniqueLabeled[0]);
  if (allShareOne) return uniqueLabeled[0];
  return undefined;
}

/** Week grain: source block if present, else recent block. */
export function resolveWeekTargetBlock(
  sources: CopySourceSession[],
  recentBlock: string,
): string | undefined {
  const uniqueLabeled = [...new Set(sources.map((source) => labeledValue(source.blockLabel)).filter(Boolean))];
  if (uniqueLabeled.length === 1) return uniqueLabeled[0];
  const recent = labeledValue(recentBlock);
  return recent || undefined;
}

function clipboardFromSources(
  grain: CopyGrain,
  sources: CopySourceSession[],
  opts: { preserveWeekLabel: boolean; targetBlockLabel?: string },
): CopyClipboard {
  const sourceDates: Record<string, string> = {};
  const titles: Record<string, string> = {};
  const sourceBlocks: Record<string, string> = {};
  for (const source of sources) {
    sourceDates[source.id] = source.date;
    titles[source.id] = source.title || 'Session';
    sourceBlocks[source.id] = labeledValue(source.blockLabel);
  }
  const clip: CopyClipboard = {
    grain,
    sessionIds: sources.map((source) => source.id),
    sourceDates,
    titles,
    sourceBlocks,
    preserveWeekLabel: opts.preserveWeekLabel,
  };
  if (opts.targetBlockLabel !== undefined) clip.targetBlockLabel = opts.targetBlockLabel;
  return clip;
}

export function buildDayClipboard(sources: CopySourceSession[], recentBlock: string): CopyClipboard {
  const targetBlockLabel = resolveDayTargetBlock(sources, recentBlock);
  return clipboardFromSources('day', sources, {
    preserveWeekLabel: true,
    ...(targetBlockLabel !== undefined ? { targetBlockLabel } : {}),
  });
}

export function buildWeekClipboard(sources: CopySourceSession[], recentBlock: string): CopyClipboard {
  const targetBlockLabel = resolveWeekTargetBlock(sources, recentBlock);
  return clipboardFromSources('week', sources, {
    preserveWeekLabel: false,
    ...(targetBlockLabel !== undefined ? { targetBlockLabel } : {}),
  });
}

export function buildBlockClipboard(sources: CopySourceSession[], blockLabel: string): CopyClipboard {
  return clipboardFromSources('block', sources, {
    preserveWeekLabel: true,
    targetBlockLabel: labeledValue(blockLabel),
  });
}

export function copyBannerText(clip: CopyClipboard): string {
  if (clip.grain === 'week') return 'Copy week — click where D1 lands';
  if (clip.grain === 'block') return 'Copy block — click where D1 lands';
  if (clip.sessionIds.length === 1) {
    return `Copy ${clip.titles[clip.sessionIds[0]] || 'session'} — click a day`;
  }
  return `Copy ${clip.sessionIds.length} sessions — click where D1 lands`;
}

export function buildCopyWeekRequest(
  clip: CopyClipboard,
  destD1: string,
  copyMode: CopyMode | boolean,
  athleteId?: string,
): CopyWeekPayload {
  const minDate = clipboardMinDate(clip);
  if (!minDate) {
    throw new Error('Copy clipboard has no source dates');
  }
  const mode: CopyMode = typeof copyMode === 'boolean' ? (copyMode ? 'logs' : 'plan') : copyMode;
  const payload: CopyWeekPayload = {
    sessionIds: clip.sessionIds,
    dateOffsetDays: dateOffsetDays(destD1, minDate),
    copyMode: mode,
    preserveWeekLabel: clip.preserveWeekLabel,
  };
  if (athleteId) payload.athleteId = athleteId;
  if (clip.targetBlockLabel !== undefined) payload.targetBlockLabel = clip.targetBlockLabel;
  return payload;
}

export type LabeledSessionGroup<T> = {
  unlabeled: T[];
  weeksNoBlock: Array<{ weekLabel: string; items: T[] }>;
  blocks: Array<{
    blockLabel: string;
    noWeek: T[];
    weeks: Array<{ weekLabel: string; items: T[] }>;
    all: T[];
  }>;
};

export function groupLabeledSessions<T>(
  items: T[],
  labelsOf: (item: T) => { blockLabel?: string | null; weekLabel?: string | null },
): LabeledSessionGroup<T> {
  const unlabeled: T[] = [];
  const weeksNoBlock = new Map<string, T[]>();
  const blocks = new Map<string, T[]>();

  for (const item of items) {
    const labels = labelsOf(item);
    const block = labeledValue(labels.blockLabel);
    const week = labeledValue(labels.weekLabel);
    if (block) {
      const list = blocks.get(block) || [];
      list.push(item);
      blocks.set(block, list);
    } else if (week) {
      const list = weeksNoBlock.get(week) || [];
      list.push(item);
      weeksNoBlock.set(week, list);
    } else {
      unlabeled.push(item);
    }
  }

  const weekEntries = (itemsInBlock: T[]) => {
    const byWeek = new Map<string, T[]>();
    const noWeek: T[] = [];
    for (const item of itemsInBlock) {
      const week = labeledValue(labelsOf(item).weekLabel);
      if (week) {
        const list = byWeek.get(week) || [];
        list.push(item);
        byWeek.set(week, list);
      } else {
        noWeek.push(item);
      }
    }
    const weeks = [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekLabel, weekItems]) => ({ weekLabel, items: weekItems }));
    return { weeks, noWeek };
  };

  return {
    unlabeled,
    weeksNoBlock: [...weeksNoBlock.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekLabel, weekItems]) => ({ weekLabel, items: weekItems })),
    blocks: [...blocks.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([blockLabel, all]) => {
        const { weeks, noWeek } = weekEntries(all);
        return { blockLabel, weeks, noWeek, all };
      }),
  };
}
