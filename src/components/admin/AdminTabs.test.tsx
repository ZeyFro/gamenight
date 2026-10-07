// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AdminTabs, ADMIN_TAB_KEYS } from "./AdminTabs";

afterEach(cleanup);

describe("AdminTabs — Communautés", () => {
  it("reconnaît la clé de route et affiche le lien quand le flag est activé", () => {
    expect(ADMIN_TAB_KEYS).toContain("communautes");

    render(<AdminTabs active="communautes" showCommunities />);

    expect(screen.getByRole("link", { name: "Communautés" }).getAttribute("href"))
      .toBe("/admin?tab=communautes");
  });

  it("masque le lien quand le flag est désactivé", () => {
    render(<AdminTabs active="messages" showCommunities={false} />);

    expect(screen.queryByRole("link", { name: "Communautés" })).toBeNull();
  });
});
