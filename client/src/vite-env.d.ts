/// <reference types="vite/client" />

/**
 * Only names starting with VITE_ are exposed to browser code. Anything else in a .env
 * file stays on the build machine — which is why API_PORT and CLIENT_PORT, read by
 * vite.config.ts, are deliberately not prefixed.
 */
interface ImportMetaEnv {
  /** e.g. https://<project-ref>.supabase.co */
  readonly VITE_SUPABASE_URL: string;
  /** The publishable key. Public by design; see the note in lib/supabase.ts. */
  readonly VITE_SUPABASE_ANON_KEY: string;
  /**
   * Where card and Pokémon images are served from, with no trailing slash. Empty or
   * unset means relative paths, answered by whatever is serving the app.
   */
  readonly VITE_IMAGE_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
