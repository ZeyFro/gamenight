// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LoginLanding } from "./LoginLanding";

vi.mock("@/components/magicui/aurora-text", () => ({
  AuroraText: ({ children }: { children: string }) => <span>{children}</span>,
}));
vi.mock("@/components/magicui/shine-border", () => ({ ShineBorder: () => null }));

const guild = "111111111111111111";
const forums = [
  ["TOWER_DISCORD_PLAYER_SEARCH_FORUM_ID", "222222222222222222", /recherche de joueurs/i],
  ["TOWER_DISCORD_RECRUITMENT_FORUM_ID", "333333333333333333", /recrutement/i],
  ["TOWER_DISCORD_ADVENTURE_FORUM_ID", "444444444444444444", /projets et aventures/i],
] as const;

function configureForums() {
  vi.stubEnv("TOWER_DISCORD_GUILD_ID", guild);
  for (const [key, id] of forums) vi.stubEnv(key, id);
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

it("donne accès aux trois forums depuis la page publique avec la connexion toujours disponible", () => {
  configureForums();
  render(<LoginLanding><button>Se connecter</button></LoginLanding>);
  expect(screen.getByRole("navigation", { name: "Forums de The Tower" })).toBeDefined();
  for (const [, id, label] of forums) {
    expect(screen.getByRole("link", { name: label }).getAttribute("href"))
      .toBe("https://discord.com/channels/" + guild + "/" + id);
  }
  expect(screen.getByRole("button", { name: "Se connecter" })).toBeDefined();
});

it("garde la page de connexion générique si les forums ne sont pas configurés", () => {
  vi.stubEnv("TOWER_DISCORD_GUILD_ID", "");
  for (const [key] of forums) vi.stubEnv(key, "");
  render(<LoginLanding><button>Se connecter</button></LoginLanding>);
  expect(screen.queryAllByRole("link")).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Se connecter" })).toBeDefined();
});

it.each(["../../bad", "333333333333333333", "", "222222222222222222 ", "222222222222222222\n", " 333333333333333333"])("masque le bloc incomplet ou invalide (%s)", (value) => {
  configureForums();
  vi.stubEnv("TOWER_DISCORD_PLAYER_SEARCH_FORUM_ID", value);
  render(<LoginLanding><button>Se connecter</button></LoginLanding>);
  expect(screen.queryAllByRole("link")).toHaveLength(0);
});
