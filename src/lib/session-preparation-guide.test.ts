import { afterEach, expect, it, vi } from "vitest";
import { guideSections } from "./guide-sections";
afterEach(() => vi.unstubAllEnvs());
it("documente la checklist dans le guide seulement quand activée", () => {
  const base = [{ icon: "", title: "Soirées", lines: [] }];
  vi.stubEnv("SESSION_PREPARATION_ENABLED", "");
  expect(guideSections(base)[0].lines.some(line => line.includes("checklist"))).toBe(false);
  vi.stubEnv("SESSION_PREPARATION_ENABLED", "true");
  expect(guideSections(base)[0].lines.some(line => line.includes("checklist"))).toBe(true);
});
