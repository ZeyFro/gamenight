const MAX_FIELD_LENGTH = 200;

const STRING_FIELDS = [
  "document-uri",
  "blocked-uri",
  "violated-directive",
  "effective-directive",
  "source-file",
  "disposition",
] as const;

function sanitizeUri(value: string): string {
  return value.split(/[?#]/)[0].slice(0, MAX_FIELD_LENGTH);
}

/** Réduit un rapport CSP legacy (`{"csp-report": {...}}`) aux champs utiles, ou `null` s'il n'est pas reconnu. */
export function summarizeCspReport(payload: unknown): Record<string, string | number> | null {
  if (typeof payload !== "object" || payload === null) return null;
  const report = (payload as Record<string, unknown>)["csp-report"];
  if (typeof report !== "object" || report === null) return null;

  const summary: Record<string, string | number> = {};
  for (const field of STRING_FIELDS) {
    const value = (report as Record<string, unknown>)[field];
    if (typeof value === "string" && value) {
      summary[field] = field.endsWith("uri") || field === "source-file"
        ? sanitizeUri(value)
        : value.slice(0, MAX_FIELD_LENGTH);
    }
  }
  const line = (report as Record<string, unknown>)["line-number"];
  if (typeof line === "number" && Number.isFinite(line)) summary["line-number"] = line;

  return Object.keys(summary).length > 0 ? summary : null;
}
