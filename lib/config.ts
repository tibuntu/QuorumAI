/** Whether the in-app document editing UI is shown. Default ON;
 *  operators opt out with EDIT_UI_ENABLED=false. UI-only — the edit API is not gated. */
export function isEditUiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EDIT_UI_ENABLED?.toLowerCase() !== "false";
}

/** The app's public origin, e.g. https://quorum.example. Falls back to localhost in dev.
 *  Treats "/" as unset: Vite (under Vitest) injects BASE_URL="/" — its public base-path
 *  default — which is not a valid origin. Mirrors better-auth's own `BASE_URL !== "/"` guard. */
export function baseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.BASE_URL;
  return value && value !== "/" ? value : "http://localhost:3000";
}
