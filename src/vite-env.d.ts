interface ImportMetaEnv {
  readonly PROD: boolean;
  readonly VITE_OFFLINE_AUTH_PUBLIC_KEY?: string;
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_CLIENT_DATA_GENERATION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
