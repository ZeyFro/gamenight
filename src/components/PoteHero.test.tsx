// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: vi.fn<() => string>() }));
vi.mock("next/navigation", () => ({ usePathname: nav.pathname }));

import { PoteHero } from "./PoteHero";

const hero = <p>APERCU-COMPLET</p>;
const compact = <p>ENTETE-COMPACT</p>;
beforeEach(() => nav.pathname.mockReset());
afterEach(cleanup);

describe("PoteHero : l'aperçu d'un pote n'occupe pas les sous-pages", () => {
  it("sur /potes/[id] : aperçu complet, pas d'en-tête compact", () => {
    nav.pathname.mockReturnValue("/potes/abc");
    render(<PoteHero poteId="abc" compact={compact}>{hero}</PoteHero>);
    expect(screen.getByText("APERCU-COMPLET")).toBeTruthy();
    expect(screen.queryByText("ENTETE-COMPACT")).toBeNull();
  });
  it.each(["/potes/abc/bibliotheque", "/potes/abc/tierlist", "/potes/abc/badges", "/potes/abc/superlatifs"])("sur %s : en-tête compact seulement", (path) => {
    nav.pathname.mockReturnValue(path);
    render(<PoteHero poteId="abc" compact={compact}>{hero}</PoteHero>);
    expect(screen.getByText("ENTETE-COMPACT")).toBeTruthy();
    expect(screen.queryByText("APERCU-COMPLET")).toBeNull();
  });
  it("l'identifiant d'un autre pote ne déclenche pas l'aperçu", () => {
    nav.pathname.mockReturnValue("/potes/autre");
    render(<PoteHero poteId="abc" compact={compact}>{hero}</PoteHero>);
    expect(screen.getByText("ENTETE-COMPACT")).toBeTruthy();
  });
});
