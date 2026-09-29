interface ImportMetaEnv {
  readonly VITE_OFFLINE_AUTH_PUBLIC_KEY?: string;
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_GOOGLE_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
