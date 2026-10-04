import { describe, expect, it } from "vitest";
import robots from "./robots";

describe("robots.txt", () => {
  it("interdit l'exploration de tout le site à tous les robots", () => {
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });
});
