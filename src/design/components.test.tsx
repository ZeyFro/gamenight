// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BentoCard, BentoGrid } from "./BentoCard";
import { BottomNav, type BottomNavItem } from "./BottomNav";
import { HomeIcon, TrophyIcon } from "./icons";
import { LaunchFab } from "./LaunchFab";
import { SectionHeader } from "./SectionHeader";
import { StatTile } from "./StatTile";

afterEach(cleanup);

describe("BentoCard / BentoGrid", () => {
  it("affiche son contenu avec les attributs de mise en page par défaut", () => {
    render(
      <BentoGrid>
        <BentoCard aria-label="Carte test">contenu</BentoCard>
      </BentoGrid>
    );
    const card = screen.getByLabelText("Carte test");
    expect(card.textContent).toBe("contenu");
    expect(card.tagName).toBe("DIV");
    expect(card.dataset.tone).toBe("default");
    expect(card.dataset.col).toBe("1");
    expect(card.dataset.row).toBe("1");
    expect(card.parentElement?.className).toContain("gn-bento");
  });

  it("transmet teinte, étendues mobile / large et délai d'entrée", () => {
    render(
      <BentoCard tone="gold" colSpan={2} mdColSpan={3} rowSpan={2} delay={120} aria-label="Large">
        x
      </BentoCard>
    );
    const card = screen.getByLabelText("Large");
    expect(card.dataset.tone).toBe("gold");
    expect(card.dataset.col).toBe("2");
    expect(card.dataset.mdCol).toBe("3");
    expect(card.dataset.row).toBe("2");
    expect(card.style.getPropertyValue("--gn-delay")).toBe("120ms");
  });

  it("devient un vrai bouton quand onPress est fourni, et réagit au clic", async () => {
    const onPress = vi.fn();
    render(<BentoCard onPress={onPress}>Ouvrir</BentoCard>);
    const button = screen.getByRole("button", { name: "Ouvrir" });
    await userEvent.click(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("sans onPress : aucun rôle bouton", () => {
    render(<BentoCard>Texte</BentoCard>);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("StatTile", () => {
  it("affiche libellé, valeur et précision", () => {
    render(<StatTile label="Série" value="6" hint="soirées d'affilée" />);
    expect(screen.getByText("Série")).toBeTruthy();
    expect(screen.getByText("6")).toBeTruthy();
    expect(screen.getByText("soirées d'affilée")).toBeTruthy();
  });

  it("marque la variation positive ou négative", () => {
    const { rerender } = render(<StatTile label="Victoires" value={23} delta={{ text: "+3", positive: true }} />);
    expect(screen.getByText("+3").getAttribute("data-positive")).toBe("true");
    rerender(<StatTile label="Victoires" value={23} delta={{ text: "-2" }} />);
    expect(screen.getByText("-2").getAttribute("data-positive")).toBe("false");
  });

  it("n'affiche ni variation ni précision quand elles sont absentes", () => {
    const { container } = render(<StatTile label="XP" value="1 200" />);
    expect(container.querySelector(".gn-stat-delta")).toBeNull();
    expect(container.querySelector(".gn-stat-hint")).toBeNull();
  });
});

describe("LaunchFab", () => {
  it("a pour nom accessible « Jouer maintenant » et déclenche onPress", async () => {
    const onPress = vi.fn();
    render(<LaunchFab onPress={onPress} />);
    await userEvent.click(screen.getByRole("button", { name: "Jouer maintenant" }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("annonce l'état du panneau seulement si `expanded` est fourni", () => {
    const { rerender } = render(<LaunchFab onPress={() => {}} />);
    const button = screen.getByRole("button", { name: "Jouer maintenant" });
    expect(button.hasAttribute("aria-expanded")).toBe(false);
    rerender(<LaunchFab onPress={() => {}} expanded />);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
  });

  it("le pulse peut être coupé, et un libellé personnalisé s'applique", () => {
    render(<LaunchFab onPress={() => {}} pulse={false} label="Lancer" />);
    const button = screen.getByRole("button", { name: "Lancer" });
    expect(button.getAttribute("data-pulse")).toBe("false");
  });
});

describe("BottomNav", () => {
  const items: BottomNavItem[] = [
    { id: "home", label: "Accueil", icon: <HomeIcon /> },
    { id: "soirees", label: "Soirées", icon: <HomeIcon /> },
    { id: "classement", label: "Classement", icon: <TrophyIcon /> },
    { id: "profil", label: "Profil", icon: <TrophyIcon /> },
  ];

  it("expose une navigation nommée avec un bouton par onglet", () => {
    render(<BottomNav items={items} activeId="home" onSelect={() => {}} fab={<LaunchFab onPress={() => {}} />} />);
    const nav = screen.getByRole("navigation", { name: "Navigation principale" });
    expect(within(nav).getAllByRole("button")).toHaveLength(5);
  });

  it("marque uniquement l'onglet actif avec aria-current", () => {
    render(<BottomNav items={items} activeId="classement" onSelect={() => {}} fab={<span />} />);
    const current = screen.getAllByRole("button").filter((b) => b.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0].textContent).toContain("Classement");
  });

  it("appelle onSelect avec l'identifiant de l'onglet cliqué", async () => {
    const onSelect = vi.fn();
    render(<BottomNav items={items} activeId="home" onSelect={onSelect} fab={<span />} />);
    await userEvent.click(screen.getByRole("button", { name: /Profil/ }));
    expect(onSelect).toHaveBeenCalledWith("profil");
  });

  it("place le bouton central entre les deux moitiés d'onglets", () => {
    render(<BottomNav items={items} activeId="home" onSelect={() => {}} fab={<LaunchFab onPress={() => {}} />} />);
    const labels = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(labels).toEqual([
      expect.stringContaining("Accueil"),
      expect.stringContaining("Soirées"),
      "Jouer maintenant",
      expect.stringContaining("Classement"),
      expect.stringContaining("Profil"),
    ]);
  });
});

describe("SectionHeader", () => {
  it("rend un titre de niveau 2 par défaut, ou 3 à la demande", () => {
    const { rerender } = render(<SectionHeader title="Classement" />);
    expect(screen.getByRole("heading", { level: 2, name: "Classement" })).toBeTruthy();
    rerender(<SectionHeader title="Classement" as="h3" />);
    expect(screen.getByRole("heading", { level: 3, name: "Classement" })).toBeTruthy();
  });

  it("affiche le sous-titre et déclenche l'action", async () => {
    const onAction = vi.fn();
    render(<SectionHeader title="Potes" subtitle="3 connectés" actionLabel="Tout voir" onAction={onAction} />);
    expect(screen.getByText("3 connectés")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Tout voir" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("n'affiche pas d'action sans libellé ou sans gestionnaire", () => {
    const { rerender } = render(<SectionHeader title="A" actionLabel="Voir" />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<SectionHeader title="A" onAction={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
