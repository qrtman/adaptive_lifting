// Production API calls always use same-origin /api, which the host routes to
// Supabase Edge. Vite's separate-origin override is development-only.
const configuredDevelopmentOrigin = import.meta.env.PROD
  ? ''
  : import.meta.env.VITE_BACKEND_URL || '';
export const API_BASE_URL = configuredDevelopmentOrigin.replace(/\/+$/, '');
