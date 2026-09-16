/** Display labels for the session header. Stored values may be "1", "Week1", or "Hypertrophy". */

export type PlanLabelKind = 'Block' | 'Week';

export function formatPlanLabel(kind: PlanLabelKind, raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const stripped = trimmed.replace(new RegExp(`^${kind}\\s*`, 'i'), '').trim();
  if (!stripped) return kind;
  return `${kind} ${stripped}`;
}
