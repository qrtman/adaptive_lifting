export function shouldDisableCoachAction(isCoach: boolean, capability: boolean | null): boolean {
  return isCoach && capability === false;
}

export function formatAthleteUsage(active: number, limit: number | null): string {
  return limit === null ? `${active} athletes · Unlimited` : `${active} / ${limit} athletes`;
}
