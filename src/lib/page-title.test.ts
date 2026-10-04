import { afterEach, describe, expect, it, vi } from "vitest";
import { pageMetadata } from "./page-title";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("pageMetadata", () => {
  it("drapeau absent : aucun titre", () => {
    vi.stubEnv("PAGE_TITLES_ENABLED", "");
    expect(pageMetadata("Calendrier")).toEqual({});
  });

  it.each(["TRUE", "1", "yes", " true"])("valeur %j : aucun titre (seul « true » active)", (value) => {
    vi.stubEnv("PAGE_TITLES_ENABLED", value);
    expect(pageMetadata("Calendrier")).toEqual({});
  });

  it("PAGE_TITLES_ENABLED=true : titre de la page", () => {
    vi.stubEnv("PAGE_TITLES_ENABLED", "true");
    expect(pageMetadata("Calendrier")).toEqual({ title: "Calendrier" });
  });
});
