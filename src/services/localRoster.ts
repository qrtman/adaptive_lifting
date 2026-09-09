import { SEEDED_ATHLETES } from '../data/fixtures/seededRoster';
import type { LocalAthlete } from '../types';
import { getSnapshot, saveSnapshot } from './db';

export type { LocalAthlete };

const SNAPSHOT_ID = 'coach-local-roster';

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
  await saveSnapshot(SNAPSHOT_ID, SEEDED_ATHLETES);
  return SEEDED_ATHLETES;
}

export function rosterHasName(roster: LocalAthlete[], name: string): boolean {
  const needle = name.trim().toLowerCase();
  return roster.some((row) => row.name.trim().toLowerCase() === needle);
}

export class DuplicateAthleteNameError extends Error {
  constructor() {
    super('That name is already on the roster.');
    this.name = 'DuplicateAthleteNameError';
  }
}

export async function addLocalAthlete(athlete: Omit<LocalAthlete, 'id' | 'linked'>): Promise<LocalAthlete[]> {
  const current = await loadLocalRoster();
  const name = athlete.name.trim();
  if (rosterHasName(current, name)) {
    throw new DuplicateAthleteNameError();
  }
  const next: LocalAthlete = {
    ...athlete,
    name,
    id: `athlete-${Date.now()}`,
    linked: false,
  };
  const roster = [...current, next];
  await saveSnapshot(SNAPSHOT_ID, roster);
  return roster;
}
