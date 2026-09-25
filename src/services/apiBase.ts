const env = import.meta.env;
const productionOrigin = env.PROD
  ? (typeof window !== 'undefined' ? window.location.origin : '')
  : 'http://localhost:8000';

export const API_BASE_URL = (env.VITE_BACKEND_URL || productionOrigin).replace(/\/+$/, '');
