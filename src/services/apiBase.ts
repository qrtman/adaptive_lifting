// API calls are same-origin by default in every build. Vite proxies /api during
// development; production's reverse proxy should route /api to FastAPI.
// VITE_BACKEND_URL is an explicit escape hatch for deployments with a separate
// API origin. It must include the origin only (for example https://api.example.com).
export const API_BASE_URL = (import.meta.env.VITE_BACKEND_URL || '').replace(/\/+$/, '');
