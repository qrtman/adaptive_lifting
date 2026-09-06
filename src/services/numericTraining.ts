/** Coerce training values to numbers. Empty / invalid input is null, never a string. */

export function trainingNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function trainingInt(value: unknown): number | null {
  const parsed = trainingNumber(value);
  return parsed === null ? null : Math.round(parsed);
}

export function trainingOrZero(value: unknown): number {
  return trainingNumber(value) ?? 0;
}

export function trainingIntOrZero(value: unknown): number {
  return trainingInt(value) ?? 0;
}

export function displayTrainingValue(value: unknown): string {
  const parsed = trainingNumber(value);
  return parsed === null ? "" : String(parsed);
}
