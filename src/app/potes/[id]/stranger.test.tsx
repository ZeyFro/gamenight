import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), find: vi.fn(), card: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/community-isolation", () => ({ getPoteAccess: mocks.access }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.find } } }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw Error(`REDIRECT:${url}`); },
  notFound: () => { throw Error("NOT_FOUND"); },
}));
vi.mock("@/components/potes/StrangerPoteCard", () => ({
  StrangerPoteCard: (props: { viewerId: string; poteId: string }) => { mocks.card(props); return <p>FICHE-REDUITE</p>; },
}));

import PoteLayout from "./layout";
const props = { children: <p>CONTENU-DU-PROFIL</p>, params: Promise.resolve({ id: "pote" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "viewer" });
});

describe("fiche d'un membre qui n'est pas ami (POTES_FRIENDS_ENABLED)", () => {
  it("n'affiche que la fiche réduite : ni le contenu du profil, ni aucune lecture de la fiche complète", async () => {
    mocks.access.mockResolvedValue("stranger");
    const html = renderToStaticMarkup(await PoteLayout(props));
    expect(html).toContain("FICHE-REDUITE");
    expect(html).not.toContain("CONTENU-DU-PROFIL");
    expect(mocks.card).toHaveBeenCalledWith({ viewerId: "viewer", poteId: "pote" });
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it("profil masqué, autre serveur ou inexistant : 404, indistincts", async () => {
    mocks.access.mockResolvedValue("none");
    await expect(PoteLayout(props)).rejects.toThrow("NOT_FOUND");
    expect(mocks.find).not.toHaveBeenCalled();
  });
  it("visiteur non connecté : redirection avant tout contrôle", async () => {
    mocks.user.mockResolvedValue(null);
    await expect(PoteLayout(props)).rejects.toThrow("REDIRECT:");
    expect(mocks.access).not.toHaveBeenCalled();
  });
});
