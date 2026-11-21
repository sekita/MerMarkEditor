/// <reference types="vite/client" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

interface ImportMetaEnv {
  /** Fork builds: owner/repo whose GitHub Releases are checked for updates. */
  readonly VITE_RELEASE_REPO?: string;
  /** Fork builds: build number (workflow run number). */
  readonly VITE_RELEASE_BUILD?: string;
}
