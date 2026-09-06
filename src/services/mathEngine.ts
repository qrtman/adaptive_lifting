/**
 * Frontend replica of backend/math_utils.py.
 * Backend remains canonical after sync; these functions exist for instant UI feedback.
 */

import { trainingIntOrZero, trainingOrZero } from './numericTraining';

export const RPE_CHART: Record<number, Record<number, number>> = {
  1:  { 10: 1.00, 9.5: 0.978, 9: 0.955, 8.5: 0.932, 8: 0.91, 7.5: 0.892, 7: 0.875, 6.5: 0.858, 6: 0.841 },
  2:  { 10: 0.955, 9.5: 0.939, 9: 0.922, 8.5: 0.901, 8: 0.88, 7.5: 0.862, 7: 0.85, 6.5: 0.833, 6: 0.816 },
  3:  { 10: 0.922, 9.5: 0.907, 9: 0.892, 8.5: 0.874, 8: 0.855, 7.5: 0.837, 7: 0.82, 6.5: 0.803, 6: 0.786 },
  4:  { 10: 0.892, 9.5: 0.877, 9: 0.862, 8.5: 0.844, 8: 0.825, 7.5: 0.807, 7: 0.79, 6.5: 0.773, 6: 0.756 },
  5:  { 10: 0.863, 9.5: 0.848, 9: 0.833, 8.5: 0.815, 8: 0.796, 7.5: 0.778, 7: 0.76, 6.5: 0.743, 6: 0.726 },
  6:  { 10: 0.833, 9.5: 0.818, 9: 0.803, 8.5: 0.785, 8: 0.767, 7.5: 0.748, 7: 0.73, 6.5: 0.713, 6: 0.696 },
  7:  { 10: 0.803, 9.5: 0.788, 9: 0.772, 8.5: 0.754, 8: 0.736, 7.5: 0.718, 7: 0.70, 6.5: 0.683, 6: 0.665 },
  8:  { 10: 0.772, 9.5: 0.757, 9: 0.741, 8.5: 0.723, 8: 0.705, 7.5: 0.688, 7: 0.67, 6.5: 0.653, 6: 0.635 },
  9:  { 10: 0.741, 9.5: 0.726, 9: 0.71, 8.5: 0.692, 8: 0.674, 7.5: 0.657, 7: 0.64, 6.5: 0.622, 6: 0.605 },
  10: { 10: 0.710, 9.5: 0.695, 9: 0.679, 8.5: 0.661, 8: 0.643, 7.5: 0.626, 7: 0.61, 6.5: 0.592, 6: 0.575 },
};

export function getRpePercentage(reps: number, rpe: number): number {
  if (reps <= 0 || rpe <= 0) return 0;
  const roundedReps = Math.round(reps);
  const roundedRpe = Math.round(rpe * 2) / 2;

  if (RPE_CHART[roundedReps] && RPE_CHART[roundedReps][roundedRpe] !== undefined) {
    return RPE_CHART[roundedReps][roundedRpe];
  }

  const effectiveReps = reps + (10 - rpe);
  if (effectiveReps <= 0) return 1.0;
  return Math.max(0, 1.0278 - 0.0278 * effectiveReps);
}

/** Mirrors calculate_e1rm_linear_decay in backend/math_utils.py */
export function calculateE1RM(weight: number, reps: number, rpe: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (rpe < 6.0 || reps > 12) return weight;

  let effectiveDropPct = 0.03 * (10 - rpe + reps - 1);
  if (effectiveDropPct > 0.25) effectiveDropPct = 0.25;

  const denominator = 1.0 - effectiveDropPct;
  if (denominator <= 0.1) return weight;

  return Math.round((weight / denominator) * 100) / 100;
}

export function calculateINOL(reps: number, intensityPct: number): number {
  if (intensityPct >= 100.0) return reps * 1.0;
  if (intensityPct <= 0) return 0;
  return Math.round((reps / (100.0 - intensityPct)) * 100) / 100;
}

export function calculateDOTS(gender: string, bodyweight: number, total: number): number {
  if (bodyweight <= 0 || total <= 0) return 0;

  const B = bodyweight;
  let A: number;
  let C: number;
  let D: number;
  let E: number;
  let F: number;
  let G: number;

  if (gender.toUpperCase() === 'MALE') {
    A = -301.121601;
    C = 7.36780443;
    D = -0.0558457223;
    E = 0.000188177439;
    F = -0.000000282121544;
    G = 0.000000000171720513;
  } else {
    A = -57.9628886;
    C = 4.25433917;
    D = -0.0384807498;
    E = 0.000177727402;
    F = -0.000000412850389;
    G = 0.000000000416960297;
  }

  let denominator =
    A + B * C + B ** 2 * D + B ** 3 * E + B ** 4 * F + B ** 5 * G;
  denominator = Math.abs(denominator);
  if (denominator === 0) return 0;

  return Math.round(((total * 500.0) / denominator) * 100) / 100;
}

export function roundToCompetitionPlates(weight: number): number {
  return Math.round(weight / 2.5) * 2.5;
}

export function calculateAttemptJumps(
  firstAttempt: number,
  profile: string,
  gender: string = 'MALE'
): { suggested_second: string; third_ceiling: string } {
  let minSecond = roundToCompetitionPlates(firstAttempt * 1.075);
  let maxSecond = roundToCompetitionPlates(firstAttempt * 1.10);

  if (minSecond >= maxSecond) {
    maxSecond = minSecond + 2.5;
  }

  let ceiling: number;
  if (profile === 'squat_dl') {
    ceiling = roundToCompetitionPlates(maxSecond * 1.10);
  } else if (gender === 'MALE') {
    ceiling = maxSecond + 10.0;
  } else {
    ceiling = maxSecond + 4.0;
  }

  return {
    suggested_second: `${minSecond}kg - ${maxSecond}kg`,
    third_ceiling: `${ceiling}kg`,
  };
}

export function calculateACWR(workouts: any[]): Array<{
  date: string;
  daily_tonnage: number;
  acute_workload: number;
  chronic_workload: number;
  acwr: number;
  zone: string;
}> {
  const dailyTonnages = new Map<string, number>();

  for (const w of workouts) {
    const dateStr = w?.date;
    if (!dateStr || Number.isNaN(Date.parse(dateStr))) continue;

    let workoutTonnage = 0;
    const exercises = w.exercises || [];
    for (const exercise of exercises) {
      for (const set of exercise.sets || []) {
        const wt = trainingOrZero(set.actual);
        const rp = trainingIntOrZero(set.reps);
        if (wt > 0 && rp > 0) workoutTonnage += wt * rp;
      }
    }

    const stored = Number(w.tonnage || 0);
    const finalT = Math.max(workoutTonnage, stored);
    dailyTonnages.set(dateStr, (dailyTonnages.get(dateStr) || 0) + finalT);
  }

  const dates = [...dailyTonnages.keys()].sort();
  if (dates.length === 0) return [];

  const toDate = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  };
  const toIso = (dt: Date) => dt.toISOString().slice(0, 10);
  const shift = (iso: string, days: number) => {
    const dt = toDate(iso);
    dt.setUTCDate(dt.getUTCDate() + days);
    return toIso(dt);
  };

  const startDate = dates[0];
  const endDate = dates[dates.length - 1];
  const allDaily = new Map<string, number>();
  let cursor = shift(startDate, -27);
  while (cursor <= endDate) {
    allDaily.set(cursor, dailyTonnages.get(cursor) || 0);
    cursor = shift(cursor, 1);
  }

  const series = [];
  cursor = startDate;
  while (cursor <= endDate) {
    let acuteSum = 0;
    for (let i = 0; i < 7; i++) {
      acuteSum += allDaily.get(shift(cursor, -i)) || 0;
    }
    let chronicSum = 0;
    for (let i = 0; i < 28; i++) {
      chronicSum += allDaily.get(shift(cursor, -i)) || 0;
    }

    const chronicAvg = chronicSum / 28.0;
    let acwr = 1.0;
    if (chronicAvg > 0) {
      acwr = Math.round((acuteSum / (chronicAvg * 7)) * 100) / 100;
    } else if (acuteSum !== 0) {
      acwr = 0.0;
    }

    let zone = 'DANGER_ZONE';
    if (acwr < 0.8) zone = 'UNDER_TRAINING';
    else if (acwr <= 1.3) zone = 'OPTIMAL_ZONE';
    else if (acwr <= 1.5) zone = 'ELEVATED_FATIGUE';

    series.push({
      date: cursor,
      daily_tonnage: Math.round((dailyTonnages.get(cursor) || 0) * 100) / 100,
      acute_workload: Math.round(acuteSum * 100) / 100,
      chronic_workload: Math.round(chronicSum * 100) / 100,
      acwr,
      zone,
    });

    cursor = shift(cursor, 1);
  }

  return series;
}

export function calculateCapacityScaledWeight(
  baselineE1RM: number,
  intensityType: 'RPE' | 'PERCENT',
  targetValue: number,
  reps: number,
  adjustmentPct: number = 0
): number {
  const adjustedE1RM = baselineE1RM * (1 + adjustmentPct);
  const baseIntensityPct =
    intensityType === 'PERCENT' ? targetValue / 100 : getRpePercentage(reps, targetValue);
  const rawWeight = adjustedE1RM * baseIntensityPct;
  return roundToCompetitionPlates(rawWeight);
}

/** Inverse of calculateE1RM linear decay, for prescription preview. */
export function calculateWeightFromE1RM(e1RM: number, reps: number, rpe: number): number {
  if (!e1RM || !reps || !rpe) return 0;
  if (rpe < 6.0 || reps > 12) return e1RM;

  let effectiveDropPct = 0.03 * (10 - rpe + reps - 1);
  if (effectiveDropPct > 0.25) effectiveDropPct = 0.25;

  const denominator = 1.0 - effectiveDropPct;
  if (denominator <= 0.1) return e1RM;

  return Math.max(0, e1RM * denominator);
}
