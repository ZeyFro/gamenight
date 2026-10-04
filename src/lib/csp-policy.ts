/**
 * Politique CSP de GameNight (en-tête `Content-Security-Policy-Report-Only`,
 * voir `next.config.ts`). Isolée ici pour être testable.
 *
 * `reportEnabled` (drapeau `CSP_REPORT_ENABLED`, éteint par défaut) ajoute
 * `report-uri /api/csp-report` : les navigateurs y envoient chaque violation,
 * journalisée par `src/app/api/csp-report/route.ts`. Sans lui, la politique est
 * strictement identique à celle d'avant.
 */
export const CSP_REPORT_PATH = "/api/csp-report";

export function isCspReportEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.CSP_REPORT_ENABLED === "true";
}

export function buildCsp({
  isDev,
  reportEnabled,
}: {
  isDev: boolean;
  reportEnabled: boolean;
}): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-src https://www.youtube-nocookie.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://discord.com https://steamcommunity.com",
    "frame-ancestors 'none'",
  ];
  if (reportEnabled) directives.push(`report-uri ${CSP_REPORT_PATH}`);
  return directives.join("; ");
}
