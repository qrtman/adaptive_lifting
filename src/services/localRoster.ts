import { getSnapshot, saveSnapshot } from './db';

export type LocalAthlete = {
  id: string;
  name: string;
  email: string | null;
  currentBlock: string | null;
  activeMicrocycles: number;
  peakE1RM: {
    squat: number | null;
    bench: number | null;
    deadlift: number | null;
  };
  linked: boolean;
};

const SNAPSHOT_ID = 'coach-local-roster';

/** Week 5 executed top singles from Zahar Block 3.1 (numeric e1RM, not parsed Rx). */
export const ZAHAR_ATHLETE: LocalAthlete = {
  id: 'athlete-zahar',
  name: 'Zahar',
  email: null,
  currentBlock: 'Block 3.1',
  activeMicrocycles: 1,
  peakE1RM: {
    squat: 191.1,
    bench: 135.6,
    deadlift: 231.5,
  },
  linked: false,
};

export function mergeRoster(
  remote: Array<{ id: string; email?: string; activeMicrocycles?: number }>,
  local: LocalAthlete[],
): LocalAthlete[] {
  const byId = new Map<string, LocalAthlete>();
  for (const row of local) {
    byId.set(row.id, row);
  }
  for (const row of remote) {
    const existing = byId.get(row.id);
    byId.set(row.id, {
      id: row.id,
      name: existing?.name || (row.email ? row.email.split('@')[0] : 'Athlete'),
      email: row.email ?? existing?.email ?? null,
      currentBlock: existing?.currentBlock ?? null,
      activeMicrocycles: row.activeMicrocycles ?? existing?.activeMicrocycles ?? 0,
      peakE1RM: existing?.peakE1RM ?? { squat: null, bench: null, deadlift: null },
      linked: true,
    });
  }
  return Array.from(byId.values());
}

export async function loadLocalRoster(): Promise<LocalAthlete[]> {
  const stored = await getSnapshot(SNAPSHOT_ID);
  if (Array.isArray(stored) && stored.length > 0) {
    return stored as LocalAthlete[];
  }
  await saveSnapshot(SNAPSHOT_ID, [ZAHAR_ATHLETE]);
  return [ZAHAR_ATHLETE];
}

export async function addLocalAthlete(athlete: Omit<LocalAthlete, 'id' | 'linked'>): Promise<LocalAthlete[]> {
  const current = await loadLocalRoster();
  const next: LocalAthlete = {
    ...athlete,
    id: `athlete-${Date.now()}`,
    linked: false,
  };
  const roster = [...current, next];
  await saveSnapshot(SNAPSHOT_ID, roster);
  return roster;
}
