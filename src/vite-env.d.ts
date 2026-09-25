interface ImportMetaEnv {
  readonly PROD: boolean;
  readonly VITE_BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
