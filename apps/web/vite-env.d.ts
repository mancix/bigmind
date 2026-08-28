/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SYNC_TRANSPORT?: 'fake' | 'http';
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
/// <reference types="vite-plugin-pwa/react" />
