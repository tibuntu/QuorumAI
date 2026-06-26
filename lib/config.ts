/** Whether the in-app document editing UI is shown. Default ON;
 *  operators opt out with EDIT_UI_ENABLED=false. UI-only — the edit API is not gated. */
export function isEditUiEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.EDIT_UI_ENABLED?.toLowerCase() !== "false";
}

/** Max accepted size (bytes, UTF-8) of a plan's markdown on create/revise.
 *  Guards an unbounded TEXT column against an unthrottled, retrying agent.
 *  Override with MAX_PLAN_BYTES; default 1 MB. */
export function maxPlanBytes(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.MAX_PLAN_BYTES);
  return Number.isFinite(n) && n > 0 ? n : 1_000_000;
}

/** Max accepted plan title length (chars). */
export const MAX_PLAN_TITLE_CHARS = 1000;

/** The app's public origin, e.g. https://consensum.example. Falls back to localhost in dev.
 *  Treats "/" as unset: Vite (under Vitest) injects BASE_URL="/" — its public base-path
 *  default — which is not a valid origin. Mirrors better-auth's own `BASE_URL !== "/"` guard. */
export function baseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.BASE_URL;
  return value && value !== "/" ? value : "http://localhost:3000";
}
