import { describe, expect, it } from "vitest";
import { buildCsp, CSP_REPORT_PATH, isCspReportEnabled } from "./csp-policy";

describe("buildCsp", () => {
  it("sans collecte : aucune directive de rapport", () => {
    const csp = buildCsp({ isDev: false, reportEnabled: false });
    expect(csp).not.toContain("report-uri");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("avec collecte : même politique + report-uri en dernier", () => {
    const without = buildCsp({ isDev: false, reportEnabled: false });
    const withReport = buildCsp({ isDev: false, reportEnabled: true });
    expect(withReport).toBe(`${without}; report-uri ${CSP_REPORT_PATH}`);
  });

  it("'unsafe-eval' uniquement en développement", () => {
    expect(buildCsp({ isDev: true, reportEnabled: false })).toContain("'unsafe-eval'");
    expect(buildCsp({ isDev: false, reportEnabled: false })).not.toContain("'unsafe-eval'");
  });
});

describe("isCspReportEnabled", () => {
  it("seule la valeur exacte « true » active", () => {
    expect(isCspReportEnabled({ CSP_REPORT_ENABLED: "true" })).toBe(true);
    for (const value of [undefined, "", "TRUE", "1", "yes", " true"]) {
      expect(isCspReportEnabled({ CSP_REPORT_ENABLED: value })).toBe(false);
    }
  });
});
