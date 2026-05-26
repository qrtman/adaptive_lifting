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

export const getRpePercentage = (reps: number, rpe: number): number => {
  if (reps <= 0 || rpe <= 0) return 0;
  const roundedReps = Math.round(reps);
  const roundedRpe = Math.round(rpe * 2) / 2;
  
  if (RPE_CHART[roundedReps] && RPE_CHART[roundedReps][roundedRpe] !== undefined) {
    return RPE_CHART[roundedReps][roundedRpe];
  }
  
  // Fallback formula mapping
  const effectiveReps = reps + (10 - rpe);
  if (effectiveReps <= 0) return 1.0;
  return Math.max(0, 1.0278 - 0.0278 * effectiveReps);
};

export const calculateCapacityScaledWeight = (
  baselineE1RM: number,
  intensityType: "RPE" | "PERCENT",
  targetValue: number,
  reps: number,
  adjustmentPct: number = 0
): number => {
  // 1. Adjusted e1RM = Baseline e1RM * (1 + Adjustment %)
  const adjustedE1RM = baselineE1RM * (1 + adjustmentPct);

  // 2. Determine Base Intensity %
  let baseIntensityPct = 0;
  if (intensityType === "PERCENT") {
    baseIntensityPct = targetValue / 100;
  } else {
    baseIntensityPct = getRpePercentage(reps, targetValue);
  }

  // 3. Raw Weight = Adjusted e1RM * Base Intensity %
  const rawWeight = adjustedE1RM * baseIntensityPct;

  // 4. Prescribed Weight = Round(Raw Weight / 2.5) * 2.5
  return Math.round(rawWeight / 2.5) * 2.5;
};

export const calculateE1RM = (weight: number, reps: number, rpe: number) => {
  if (!weight || !reps || !rpe) return 0;
  // Approximation: Adding (10 - RPE) to reps to estimate equivalent 10RPE intensity
  const effectiveReps = reps + (10 - rpe);
  if (effectiveReps <= 0) return weight;
  return weight / (1.0278 - 0.0278 * effectiveReps);
};

export const calculateWeightFromE1RM = (e1RM: number, reps: number, rpe: number) => {
  if (!e1RM || !reps || !rpe) return 0;
  const effectiveReps = reps + (10 - rpe);
  if (effectiveReps <= 0) return e1RM;
  const multiplier = 1.0278 - 0.0278 * effectiveReps;
  return Math.max(0, e1RM * multiplier);
};
