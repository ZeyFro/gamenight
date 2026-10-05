import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Endpoint d'interactions Discord (`POST /api/discord/interactions`), commande
 * `/gamenight setup`. Route PUBLIQUE : seule la signature Ed25519 l'authentifie.
 * Fail-closed (clé absente = 503, signature invalide = 401), PING toujours
 * acquitté, commande derrière `COMMUNITY_SETUP_COMMAND_ENABLED` (éteint par
 * défaut) et permission `MANAGE_GUILD` revérifiée côté serveur.
 */

const { verify, setup } = vi.hoisted(() => ({ verify: vi.fn(), setup: vi.fn() }));
vi.mock("@/lib/discord-signature", () => ({ verifyDiscordSignature: verify }));
vi.mock("@/lib/community-setup", () => ({ setupCommunityFromGuild: setup }));

import { handleDiscordInteraction } from "./discord-interactions";

const MANAGE_GUILD = String(1 << 5);
const ADMINISTRATOR = String(1 << 3);
const SEND_MESSAGES = String(1 << 11);

const command = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 2,
    guild_id: "123456789012345678",
    member: { permissions: MANAGE_GUILD, user: { id: "777" } },
    data: { name: "gamenight", options: [{ name: "setup", type: 1 }] },
    ...over,
  });
const PING = JSON.stringify({ type: 1 });

const handle = (rawBody: string, headers: { signature?: string | null; timestamp?: string | null } = {}) =>
  handleDiscordInteraction({
    rawBody,
    signature: headers.signature === undefined ? "sig" : headers.signature,
    timestamp: headers.timestamp === undefined ? "123" : headers.timestamp,
  });

const content = (out: { body?: unknown }) => (out.body as { data: { content: string } }).data.content;

describe("handleDiscordInteraction", () => {
  beforeEach(() => {
    verify.mockReset().mockReturnValue(true);
    setup.mockReset().mockResolvedValue({ action: "activated", communityId: "c1" });
    vi.stubEnv("DISCORD_APP_PUBLIC_KEY", "ab".repeat(32));
    vi.stubEnv("COMMUNITY_SETUP_COMMAND_ENABLED", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  describe("authentification (fail-closed)", () => {
    it("clé publique non configurée : 503, rien n'est activé", async () => {
      vi.stubEnv("DISCORD_APP_PUBLIC_KEY", "");
      await expect(handle(command())).resolves.toEqual({ status: 503 });
      expect(setup).not.toHaveBeenCalled();
    });

    it("signature invalide : 401, même pour un PING et pour une commande valide", async () => {
      verify.mockReturnValue(false);
      await expect(handle(PING)).resolves.toEqual({ status: 401 });
      await expect(handle(command())).resolves.toEqual({ status: 401 });
      expect(setup).not.toHaveBeenCalled();
    });

    it("signature vérifiée sur le corps BRUT, la clé de l'environnement et l'horodatage", async () => {
      await handle(command(), { signature: "sig-x", timestamp: "999" });
      expect(verify).toHaveBeenCalledWith({
        publicKeyHex: "ab".repeat(32),
        signatureHex: "sig-x",
        timestamp: "999",
        rawBody: command(),
      });
    });

    it("corps non JSON ou de forme inattendue : 400 (après la signature)", async () => {
      await expect(handle("pas du json")).resolves.toEqual({ status: 400 });
      await expect(handle(JSON.stringify({ foo: 1 }))).resolves.toEqual({ status: 400 });
    });
  });

  it("PING : PONG, même sans interrupteur (nécessaire pour enregistrer l'URL au portail)", async () => {
    vi.stubEnv("COMMUNITY_SETUP_COMMAND_ENABLED", "");
    await expect(handle(PING)).resolves.toEqual({ status: 200, body: { type: 1 } });
  });

  it("type d'interaction non géré (composant) : 400", async () => {
    await expect(handle(JSON.stringify({ type: 3 }))).resolves.toEqual({ status: 400 });
  });

  describe("/gamenight setup", () => {
    it("MANAGE_GUILD : active le serveur, réponse éphémère sans aucune mention", async () => {
      const out = await handle(command());
      expect(setup).toHaveBeenCalledWith("123456789012345678", "777");
      expect(out.status).toBe(200);
      expect(out.body).toMatchObject({ type: 4, data: { flags: 64, allowed_mentions: { parse: [] } } });
      expect(content(out)).toContain("activé");
    });

    it("ADMINISTRATOR sans MANAGE_GUILD explicite : autorisé", async () => {
      await handle(command({ member: { permissions: ADMINISTRATOR, user: { id: "777" } } }));
      expect(setup).toHaveBeenCalledOnce();
    });

    it.each([
      ["permission insuffisante", { permissions: SEND_MESSAGES, user: { id: "777" } }],
      ["permissions absentes", { user: { id: "777" } }],
      ["permissions illisibles", { permissions: "abc", user: { id: "777" } }],
    ])("%s : refusé, rien n'est activé", async (_label, member) => {
      const out = await handle(command({ member }));
      expect(setup).not.toHaveBeenCalled();
      expect(content(out)).toContain("Gérer le serveur");
    });

    it("hors serveur (MP, pas de guild_id/member) : refusé, rien n'est activé", async () => {
      const out = await handle(command({ guild_id: undefined, member: undefined }));
      expect(setup).not.toHaveBeenCalled();
      expect(content(out)).toContain("dans un serveur");
    });

    it("interrupteur éteint : aucune activation, message explicite", async () => {
      vi.stubEnv("COMMUNITY_SETUP_COMMAND_ENABLED", "1");
      const out = await handle(command());
      expect(setup).not.toHaveBeenCalled();
      expect(content(out)).toContain("pas activée");
    });

    it("autre commande ou sous-commande : inconnue, rien n'est activé", async () => {
      await handle(command({ data: { name: "autre", options: [{ name: "setup" }] } }));
      await handle(command({ data: { name: "gamenight", options: [{ name: "reset" }] } }));
      await handle(command({ data: { name: "gamenight" } }));
      expect(setup).not.toHaveBeenCalled();
    });

    it.each([
      ["already_active", "déjà activé"],
      ["blocked", "suspendu ou archivé"],
    ])("résultat %s : message adapté", async (action, text) => {
      setup.mockResolvedValue({ action, communityId: "c1" });
      expect(content(await handle(command()))).toContain(text);
    });

    it("erreur interne : réponse éphémère générique (jamais de 5xx ni de détail)", async () => {
      setup.mockRejectedValue(new Error("boom secret"));
      const out = await handle(command());
      expect(out.status).toBe(200);
      expect(content(out)).not.toContain("secret");
      expect(content(out)).toContain("erreur");
    });
  });
});

describe("scripts/discord-commands.json (commande enregistrée globalement)", () => {
  const [gamenight] = JSON.parse(
    readFileSync(new URL("../../scripts/discord-commands.json", import.meta.url), "utf8")
  ) as Array<Record<string, unknown>>;

  it("/gamenight setup, réservée par défaut à MANAGE_GUILD, serveurs uniquement", () => {
    expect(gamenight).toMatchObject({
      name: "gamenight",
      default_member_permissions: "32",
      integration_types: [0],
      contexts: [0],
      options: [{ type: 1, name: "setup" }],
    });
  });
});
