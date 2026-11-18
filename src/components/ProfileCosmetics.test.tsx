// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BadgeShowcase, ProfileBanner, ProfileCosmeticsRoot, ProfileTitle, StyledName } from "./ProfileCosmetics";
import { RankAvatar } from "./RankAvatar";
import { rankForLevel } from "@/lib/xp";
import { getProfileCosmetic } from "@/lib/profile-cosmetics";
import type { ProfilePresentation } from "@/lib/profile-customization";

const item = (id: string) => getProfileCosmetic(id);
const view = (over: Partial<ProfilePresentation> = {}): ProfilePresentation => ({
  effectsEnabled: true,
  nameStyle: item("name-aurora"), cardTheme: item("card-midnight"), frameFx: item("frame-orbit"), bannerFx: item("banner-nebula"),
  effect: item("fx-sparkles"), title: item("ptitle-climber"), entrance: item("entrance-rise"),
  showcase: [{ id: "a", name: "Premier sang", icon: "🩸" }, { id: "b", name: "Noctambule", icon: "🌙" }, { id: "c", name: "Stratège", icon: "♟" }],
  ...over,
});

afterEach(cleanup);

describe("ProfileCosmeticsRoot", () => {
  it("sans présentation (flag éteint, profil masqué) : un simple conteneur, aucune classe de personnalisation", () => {
    const { container } = render(<ProfileCosmeticsRoot view={null}><p>Contenu</p></ProfileCosmeticsRoot>);
    expect(container.innerHTML).not.toContain("pc-");
    expect(screen.getByText("Contenu")).toBeTruthy();
  });

  it("applique thème, effet et entrée par classes du catalogue et ajoute une couche décorative cachée", () => {
    const { container } = render(<ProfileCosmeticsRoot view={view()}><p>Contenu</p></ProfileCosmeticsRoot>);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className.split(" ")).toEqual(expect.arrayContaining(["pc-root", "pc-card", "pc-card-midnight", "pc-fx-sparkles", "pc-entrance-rise"]));
    expect(root.getAttribute("data-pc-effects")).toBe("on");
    const layer = root.querySelector(".pc-layer");
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    expect(layer?.textContent).toBe("");
  });

  it("expose la préférence du spectateur : effets désactivés", () => {
    const { container } = render(<ProfileCosmeticsRoot view={view({ effectsEnabled: false })}>x</ProfileCosmeticsRoot>);
    expect((container.firstElementChild as HTMLElement).getAttribute("data-pc-effects")).toBe("off");
  });

  it("n'ajoute de couche que pour les effets qui en ont besoin (brillance = texte seul)", () => {
    const { container } = render(<ProfileCosmeticsRoot view={view({ effect: item("fx-shine") })}>x</ProfileCosmeticsRoot>);
    expect(container.querySelector(".pc-layer")).toBeNull();
  });
});

describe("pseudo, titre, bannière, vitrine", () => {
  it("garde le pseudo en texte réel, stylé par classe", () => {
    render(<StyledName name="Alice" view={view()} />);
    const name = screen.getByText("Alice");
    expect(name.className).toContain("pc-name-aurora");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("n'ajoute aucun élément sans personnalisation (texte brut)", () => {
    const { container } = render(<StyledName name="Alice" view={null} />);
    expect(container.innerHTML).toBe("Alice");
  });

  it("la brillance seule stylise le pseudo sans changer sa couleur de base", () => {
    render(<StyledName name="Alice" view={view({ nameStyle: null, effect: item("fx-shine") })} />);
    expect(screen.getByText("Alice").className).toBe("pc-name");
  });

  it("affiche le titre en texte (l'information ne dépend pas de la couleur)", () => {
    render(<ProfileTitle view={view()} />);
    expect(screen.getByText("Grimpeur")).toBeTruthy();
    expect(render(<ProfileTitle view={view({ title: null })} />).container.innerHTML).toBe("");
  });

  it("cache la bannière aux technologies d'assistance", () => {
    const { container } = render(<ProfileBanner view={view()} tall />);
    const banner = container.firstElementChild as HTMLElement;
    expect(banner.getAttribute("aria-hidden")).toBe("true");
    expect(banner.className).toContain("pc-banner-nebula");
    expect(banner.className).toContain("pc-banner-tall");
    expect(render(<ProfileBanner view={view({ bannerFx: null })} />).container.innerHTML).toBe("");
  });

  it("liste la vitrine avec le nom de chaque badge", () => {
    render(<BadgeShowcase view={view()} />);
    const list = within(screen.getByRole("region", { name: "Vitrine de badges" })).getAllByRole("listitem");
    expect(list.map((li) => li.textContent)).toEqual(["🩸Premier sang", "🌙Noctambule", "♟Stratège"]);
  });

  it("n'affiche pas de vitrine vide", () => {
    expect(render(<BadgeShowcase view={view({ showcase: [] })} />).container.innerHTML).toBe("");
    expect(render(<BadgeShowcase view={null} />).container.innerHTML).toBe("");
  });
});

describe("cadre animé sur l'avatar", () => {
  it("ajoute un anneau décoratif sans changer le nom accessible du rang", () => {
    const { container } = render(<RankAvatar src={null} alt="Player" level={4} rank={rankForLevel(4)} frameFxId="frame-orbit" />);
    const ring = container.querySelector(".pc-frame-orbit");
    expect(ring?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain("Rang");
  });

  it("n'ajoute rien sans cadre animé", () => {
    const { container } = render(<RankAvatar src={null} alt="Player" level={4} rank={rankForLevel(4)} />);
    expect(container.querySelector(".pc-frame")).toBeNull();
  });
});
