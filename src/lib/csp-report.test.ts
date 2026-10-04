import { describe, expect, it } from "vitest";
import { summarizeCspReport } from "./csp-report";

describe("summarizeCspReport", () => {
  it("tronque les champs trop longs", () => {
    const summary = summarizeCspReport({
      "csp-report": { "violated-directive": "d".repeat(500) },
    });
    expect(String(summary?.["violated-directive"]).length).toBe(200);
  });

  it.each([null, "x", 3, {}, { "csp-report": null }, { "csp-report": {} }])(
    "%j : non reconnu",
    (payload) => {
      expect(summarizeCspReport(payload)).toBeNull();
    }
  );
});
