/**
 * Parses `ALLOWED_ORIGIN` into what the `cors` middleware expects: `"*"`
 * (wildcard) when unset or literally `*`, otherwise an array of exact
 * origins from a comma-separated list — so multiple frontends (marketing
 * site, app dev server, etc.) can each be allowed from one env var.
 *
 * @param {string | undefined} raw The raw `ALLOWED_ORIGIN` env var value.
 * @returns {string | string[]} `"*"`, or an array of trimmed origin strings.
 *
 */
export function parseAllowedOrigins(raw: string | undefined): string | string[] {
  if (!raw || raw.trim() === "*") {
    return "*";
  }
  return raw.split(",").map((origin: string) => origin.trim());
}
