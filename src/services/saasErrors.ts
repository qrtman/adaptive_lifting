import { ApiRequestError } from './api';

export function saasErrorMessage(error: unknown): string | null {
  if (!(error instanceof ApiRequestError)) return null;
  if (error.code === 'WORKSPACE_ACCESS_REQUIRED') return 'Active coaching access is required for this action.';
  if (error.code === 'FEATURE_NOT_INCLUDED') {
    const label = error.feature === 'integrations' ? 'Google Sheets integrations'
      : error.feature === 'analytics' ? 'analytics'
        : error.feature === 'programming' ? 'programming' : error.feature || 'this feature';
    return `This coaching plan does not include ${label}.`;
  }
  if (error.code === 'ATHLETE_LIMIT_REACHED') {
    const usage = typeof error.activeAthletes === 'number' && typeof error.maxActiveAthletes === 'number'
      ? ` ${error.activeAthletes} / ${error.maxActiveAthletes} active athletes.` : '';
    return `Athlete limit reached.${usage}`;
  }
  return null;
}
