import type { MesocycleData, MicrocycleData } from '../types';
import raw from './zaharAthleteProfile.json' with { type: 'json' };

export interface AthleteLiftProfile {
  variation: string;
  peakE1rm: number;
}

export interface AthleteProfile {
  id: string;
  name: string;
  email: string;
  role: 'ATHLETE';
  competitionLifts: {
    squat: AthleteLiftProfile;
    bench: AthleteLiftProfile;
    deadlift: AthleteLiftProfile;
  };
}

export const ZAHAR_ATHLETE: AthleteProfile = raw.athlete as AthleteProfile;

export const INITIAL_MESOCYCLE: MesocycleData[] = [raw.mesocycle as MesocycleData];

export const INITIAL_MICROCYCLES: MicrocycleData[] = raw.microcycles as MicrocycleData[];
