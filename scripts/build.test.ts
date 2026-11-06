import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Vercel build safety", () => {
  it("never applies database migrations during preview or production builds", () => {
    const source = readFileSync(new URL("./build.mjs", import.meta.url), "utf8");
    const steps = source.match(/const steps = \[([\s\S]*?)\];/)?.[1];
    expect(steps).toBeDefined();
    expect(steps).toContain('"generate"');
    expect(steps).toContain('"build"');
    expect(steps).not.toMatch(/"migrate"|"deploy"|prisma migrate deploy/);
  });
});
