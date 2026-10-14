import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Gestionnaire du webhook d'événements Discord (`POST /api/discord/webhook-events`).
 * Route PUBLIQUE : seule la signature Ed25519 l'authentifie. Fail-closed
 * (clé absente = 503, signature invalide = 401), interrupteur
 * `COMMUNITY_AUTO_CREATE_ENABLED` éteint par défaut, et une création ne produit
 * jamais autre chose qu'une communauté PENDING.
 */

const { verify, provision } = vi.hoisted(() => ({ verify: vi.fn(), provision: vi.fn() }));
vi.mock("@/lib/discord-signature", () => ({ verifyDiscordSignature: verify }));
vi.mock("@/lib/community-provisioning", () => ({ provisionCommunityFromGuild: provision }));

import { handleDiscordWebhookEvent } from "./discord-webhook-events";

const GUILD = { id: "123456789012345678", name: "Les Potes", icon: "abc" };
const authorized = (data: Record<string, unknown>) =>
  JSON.stringify({
    version: 1,
    application_id: "1",
    type: 1,
    event: { type: "APPLICATION_AUTHORIZED", timestamp: "2026-10-04T20:00:00Z", data },
  });
const GUILD_INSTALL = authorized({
  integration_type: 0,
  scopes: ["bot", "applications.commands"],
  user: { id: "777" },
  guild: GUILD,
});
const PING = JSON.stringify({ version: 1, application_id: "1", type: 0 });

const handle = (rawBody: string, headers: { signature?: string | null; timestamp?: string | null } = {}) =>
  handleDiscordWebhookEvent({
    rawBody,
    signature: headers.signature === undefined ? "sig" : headers.signature,
    timestamp: headers.timestamp === undefined ? "123" : headers.timestamp,
  });

describe("handleDiscordWebhookEvent", () => {
  beforeEach(() => {
    verify.mockReset().mockReturnValue(true);
    provision.mockReset().mockResolvedValue({ action: "created", communityId: "c1" });
    vi.stubEnv("DISCORD_APP_PUBLIC_KEY", "ab".repeat(32));
    vi.stubEnv("COMMUNITY_AUTO_CREATE_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("authentification (fail-closed)", () => {
    it("clé publique non configurée : 503, rien n'est lu ni créé", async () => {
      vi.stubEnv("DISCORD_APP_PUBLIC_KEY", "");
      await expect(handle(GUILD_INSTALL)).resolves.toEqual({ status: 503 });
      expect(provision).not.toHaveBeenCalled();
    });

    it("signature invalide : 401, aucune création, même pour un événement valide", async () => {
      verify.mockReturnValue(false);
      await expect(handle(GUILD_INSTALL)).resolves.toEqual({ status: 401 });
      expect(provision).not.toHaveBeenCalled();
    });

    it("la signature est vérifiée sur le corps BRUT, la clé de l'environnement et l'horodatage", async () => {
      await handle(GUILD_INSTALL, { signature: "sig-x", timestamp: "999" });
      expect(verify).toHaveBeenCalledWith({
        publicKeyHex: "ab".repeat(32),
        signatureHex: "sig-x",
        timestamp: "999",
        rawBody: GUILD_INSTALL,
      });
    });

    it("signature invalide AVANT tout parsing : un corps non JSON reçoit 401, pas 400", async () => {
      verify.mockReturnValue(false);
      await expect(handle("pas du json")).resolves.toEqual({ status: 401 });
    });
  });

  describe("vérification d'endpoint et événements ignorés", () => {
    it("PING signé : 204 (même interrupteur éteint)", async () => {
      vi.stubEnv("COMMUNITY_AUTO_CREATE_ENABLED", "");
      await expect(handle(PING)).resolves.toEqual({ status: 204 });
    });

    it("corps signé mais non JSON ou de forme inattendue : 400", async () => {
      await expect(handle("pas du json")).resolves.toEqual({ status: 400 });
      await expect(handle(JSON.stringify({ type: "x" }))).resolves.toEqual({ status: 400 });
    });

    it("autre type d'événement : 204 sans effet", async () => {
      const body = JSON.stringify({ version: 1, application_id: "1", type: 1, event: { type: "ENTITLEMENT_CREATE", data: {} } });
      await expect(handle(body)).resolves.toEqual({ status: 204 });
      expect(provision).not.toHaveBeenCalled();
    });
  });

  describe("APPLICATION_AUTHORIZED", () => {
    it("installation serveur avec le scope bot : crée la communauté (PENDING) avec l'installateur", async () => {
      await expect(handle(GUILD_INSTALL)).resolves.toEqual({ status: 204 });
      expect(provision).toHaveBeenCalledWith(GUILD, "777");
    });

    it.each(["", "false", "TRUE", "1"])("interrupteur %j : 204, aucune création (seule `true` active)", async (v) => {
      vi.stubEnv("COMMUNITY_AUTO_CREATE_ENABLED", v);
      await expect(handle(GUILD_INSTALL)).resolves.toEqual({ status: 204 });
      expect(provision).not.toHaveBeenCalled();
    });

    it("installation utilisateur (integration_type 1, pas de serveur) : ignorée", async () => {
      const body = authorized({ integration_type: 1, scopes: ["applications.commands"], user: { id: "777" } });
      await expect(handle(body)).resolves.toEqual({ status: 204 });
      expect(provision).not.toHaveBeenCalled();
    });

    it("serveur sans le scope bot (commandes seules) : ignoré, le bot n'y est pas", async () => {
      const body = authorized({ integration_type: 0, scopes: ["applications.commands"], user: { id: "777" }, guild: GUILD });
      await expect(handle(body)).resolves.toEqual({ status: 204 });
      expect(provision).not.toHaveBeenCalled();
    });

    it("identifiant de serveur non numérique : ignoré (jamais écrit en base)", async () => {
      const body = authorized({ integration_type: 0, scopes: ["bot"], user: { id: "777" }, guild: { ...GUILD, id: "x'; DROP" } });
      await expect(handle(body)).resolves.toEqual({ status: 204 });
      expect(provision).not.toHaveBeenCalled();
    });

    it("installateur absent ou invalide : créée sans installateur", async () => {
      const body = authorized({ integration_type: 0, scopes: ["bot"], guild: GUILD });
      await handle(body);
      expect(provision).toHaveBeenCalledWith(GUILD, null);
    });

    it("icône absente : null", async () => {
      const body = authorized({ integration_type: 0, scopes: ["bot"], user: { id: "777" }, guild: { id: GUILD.id, name: GUILD.name } });
      await handle(body);
      expect(provision).toHaveBeenCalledWith({ id: GUILD.id, name: GUILD.name, icon: null }, "777");
    });

    it("erreur de base : 500 (Discord réessaiera) ", async () => {
      provision.mockRejectedValue(new Error("db down"));
      await expect(handle(GUILD_INSTALL)).resolves.toEqual({ status: 500 });
    });
  });
});
