import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { authErrorView, DEFAULT_AUTH_ERROR_MESSAGE, discordInviteUrl } from "./auth-error-messages";

describe("message de connexion refusée (AccessDenied)", () => {
  it("dit qu'il faut être membre du serveur Discord The Tower et quoi faire", () => {
    const { message } = authErrorView("AccessDenied", {});
    expect(message).toContain("membres du serveur Discord The Tower");
    expect(message).toContain("Rejoins le serveur");
    expect(message).not.toBe("La connexion a été refusée.");
  });

  it("n'affiche pas de lien quand DISCORD_INVITE_URL est absente ou vide", () => {
    expect(authErrorView("AccessDenied", {}).inviteUrl).toBeNull();
    expect(authErrorView("AccessDenied", { DISCORD_INVITE_URL: "  " }).inviteUrl).toBeNull();
  });

  it("affiche le lien d'invitation quand DISCORD_INVITE_URL est un lien Discord officiel", () => {
    expect(authErrorView("AccessDenied", { DISCORD_INVITE_URL: "https://discord.gg/abcDEF123" }).inviteUrl).toBe("https://discord.gg/abcDEF123");
    expect(authErrorView("AccessDenied", { DISCORD_INVITE_URL: " https://discord.com/invite/abc-123 " }).inviteUrl).toBe("https://discord.com/invite/abc-123");
  });

  it.each([
    "http://discord.gg/abc",
    "https://evil.example/discord.gg/abc",
    "https://discord.gg/abc/../x",
    "https://discord.gg.evil.example/abc",
    "javascript:alert(1)",
    "https://discord.gg/",
  ])("refuse un lien qui n'est pas une invitation Discord officielle : %s", (value) => {
    expect(discordInviteUrl({ DISCORD_INVITE_URL: value })).toBeNull();
    expect(authErrorView("AccessDenied", { DISCORD_INVITE_URL: value }).inviteUrl).toBeNull();
  });

  it("ne propose le lien que pour AccessDenied", () => {
    const env = { DISCORD_INVITE_URL: "https://discord.gg/abc" };
    expect(authErrorView("Verification", env).inviteUrl).toBeNull();
    expect(authErrorView("OAuthCallbackError", env).inviteUrl).toBeNull();
  });

  it("garde les autres messages et le message par défaut", () => {
    expect(authErrorView("Configuration", {}).message).toContain("navigateur");
    expect(authErrorView("Verification", {}).message).toContain("n'est plus valide");
    expect(authErrorView("CodeInconnu", {}).message).toBe(DEFAULT_AUTH_ERROR_MESSAGE);
  });

  it("est bien utilisé par la page de connexion (plus de message générique codé en dur)", () => {
    const page = readFileSync("src/app/page.tsx", "utf8");
    expect(page).toContain("authErrorView(error)");
    expect(page).not.toContain("La connexion a été refusée.");
  });
});
