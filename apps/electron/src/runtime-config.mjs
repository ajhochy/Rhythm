/**
 * The packaged app receives this public OAuth client ID through generated build config. Local dev
 * does not run the package script, so allow the same public value through the launch environment.
 * @param {string} packagedValue
 * @param {Record<string, string | undefined>} env
 */
export function resolveGoogleDesktopClientId(packagedValue, env = process.env) {
  return env.GOOGLE_DESKTOP_CLIENT_ID?.trim() || packagedValue.trim();
}