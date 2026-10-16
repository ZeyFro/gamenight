import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addThreadMember,
  archiveThread,
  deleteChannelMessage,
  deleteThreadPermanently,
  editChannelMessage,
  listGuildChannels,
  verifyVoiceChannelDestination,
  NO_MENTIONS,
  openDmChannel,
  sendChannelMessage,
  sendRewardWebhook,
  sendDirectMessage,
  sendThreadMessage,
  startThreadFromMessage,
} from "@/lib/discord-rest";

/**
 * Client Discord REST — tests avec HTTP entièrement simulé (`fetch`
 * mocké), JAMAIS d'appel réseau réel. Fonctions pures/déterministes une
 * fois `fetch` mocké : pas de base de données, tourne dans la suite
 * rapide normale.
 */

const FAR_FUTURE = new Date("2026-01-01T00:00:30.000Z");
const NOW = new Date("2026-01-01T00:00:00.000Z");

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("discord-rest", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("DISCORD_BOT_TOKEN", "super-secret-token-value");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe("webhook de récompense", () => {
    it("accepte 204 sans token bot ni en-tête Authorization", async () => {
      vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/fake-token");
      vi.stubEnv("DISCORD_BOT_TOKEN", "");
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
      const result = await sendRewardWebhook({ content: "gain", allowedMentions: NO_MENTIONS, deadline: FAR_FUTURE, now: NOW });
      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(new Headers(fetchMock.mock.calls[0][1].headers).has("Authorization")).toBe(false);
    });

    it("conserve retry_after du 429 pour la reprise durable", async () => {
      vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/123/fake-token");
      fetchMock.mockResolvedValue(jsonResponse(429, { retry_after: 12 }));
      const result = await sendRewardWebhook({ content: "gain", allowedMentions: NO_MENTIONS, deadline: FAR_FUTURE, now: NOW });
      expect(result).toMatchObject({ ok: false, retryable: true, retryAfterMs: 12000 });
    });

    it.each(["https://example.com/api/webhooks/123/token", "http://discord.com/api/webhooks/123/token", "https://discord.com/api/channels/123/messages"])("refuse une URL hors webhook Discord : %s", async (url) => {
      vi.stubEnv("DISCORD_WEBHOOK_URL", url);
      expect(await sendRewardWebhook({ content: "gain", allowedMentions: NO_MENTIONS, deadline: FAR_FUTURE, now: NOW })).toMatchObject({ ok: false, kind: "not_configured" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("configuration manquante", () => {
    it("ne tente aucun appel réseau si DISCORD_BOT_TOKEN est absente", async () => {
      vi.stubEnv("DISCORD_BOT_TOKEN", "");
      const result = await sendChannelMessage({
        channelId: "c1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("not_configured");
        expect(result.retryable).toBe(false);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("budget de bail", () => {
    it("budget insuffisant : n'appelle jamais fetch, renvoie insufficient_lease (retryable)", async () => {
      const deadline = new Date(NOW.getTime() + 500);
      const result = await sendChannelMessage({
        channelId: "c1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline,
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("insufficient_lease");
        expect(result.retryable).toBe(true);
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("borne le timeout HTTP au budget restant, jamais au-delà", async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
      fetchMock.mockResolvedValue(jsonResponse(200, { id: "m1", channel_id: "c1" }));
      const deadline = new Date(NOW.getTime() + 3000);

      await sendChannelMessage({
        channelId: "c1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline,
        now: NOW,
      });

      expect(timeoutSpy).toHaveBeenCalledTimes(1);
      const usedMs = timeoutSpy.mock.calls[0][0];
      expect(usedMs).toBeLessThanOrEqual(3000);
      expect(usedMs).toBeGreaterThan(0);
    });

    it("plafonne le timeout même si le bail restant est très long", async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
      fetchMock.mockResolvedValue(jsonResponse(200, { id: "m1", channel_id: "c1" }));
      const deadline = new Date(NOW.getTime() + 60_000);

      await sendChannelMessage({
        channelId: "c1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline,
        now: NOW,
      });

      const usedMs = timeoutSpy.mock.calls[0][0];
      expect(usedMs).toBeLessThanOrEqual(10_000);
    });
  });

  describe("succès et récupération des identifiants", () => {
    it("sendChannelMessage renvoie messageId/channelId", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { id: "msg1", channel_id: "chan1" }));
      const result = await sendChannelMessage({
        channelId: "chan1",
        content: "hello",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result).toEqual({ ok: true, data: { messageId: "msg1", channelId: "chan1" } });
    });

    it("editChannelMessage renvoie messageId/channelId", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { id: "msg1", channel_id: "chan1" }));
      const result = await editChannelMessage({
        channelId: "chan1",
        messageId: "msg1",
        content: "updated",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result.ok).toBe(true);
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe("https://discord.com/api/v10/channels/chan1/messages/msg1");
      expect(init.method).toBe("PATCH");
    });

    it("startThreadFromMessage renvoie threadId/parentId/archived", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(201, { id: "thread1", parent_id: "chan1", thread_metadata: { archived: false } })
      );
      const result = await startThreadFromMessage({
        channelId: "chan1",
        messageId: "msg1",
        name: "Discussion",
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result).toEqual({
        ok: true,
        data: { threadId: "thread1", parentId: "chan1", archived: false },
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe("https://discord.com/api/v10/channels/chan1/messages/msg1/threads");
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({ name: "Discussion", auto_archive_duration: 1440 });
    });

    it("sendThreadMessage envoie vers le fil comme un salon normal", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { id: "msg2", channel_id: "thread1" }));
      const result = await sendThreadMessage({
        threadId: "thread1",
        content: "in thread",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result).toEqual({ ok: true, data: { messageId: "msg2", channelId: "thread1" } });
      const [url] = fetchMock.mock.calls[0];
      expect(String(url)).toBe("https://discord.com/api/v10/channels/thread1/messages");
    });

    it("archiveThread renvoie archived: true", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, { id: "thread1", parent_id: "chan1", thread_metadata: { archived: true } })
      );
      const result = await archiveThread({ threadId: "thread1", deadline: FAR_FUTURE, now: NOW });
      expect(result).toEqual({
        ok: true,
        data: { threadId: "thread1", parentId: "chan1", archived: true },
      });
      const [, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body as string)).toEqual({ archived: true, locked: undefined });
    });

    it("openDmChannel renvoie channelId", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { id: "dmchan1" }));
      const result = await openDmChannel({ userId: "user1", deadline: FAR_FUTURE, now: NOW });
      expect(result).toEqual({ ok: true, data: { channelId: "dmchan1" } });
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe("https://discord.com/api/v10/users/@me/channels");
      expect(JSON.parse(init.body as string)).toEqual({ recipient_id: "user1" });
    });
  });

  describe("erreurs HTTP et réponses malformées", () => {
    it("404 → not_found, non-retryable", async () => {
      fetchMock.mockResolvedValue(jsonResponse(404, { code: 10003, message: "Unknown Channel" }));
      const result = await sendChannelMessage({
        channelId: "gone",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("not_found");
        expect(result.retryable).toBe(false);
      }
    });

    it("400 → invalid_request, non-retryable", async () => {
      fetchMock.mockResolvedValue(jsonResponse(400, { code: 50035, message: "Invalid Form Body" }));
      const result = await sendChannelMessage({
        channelId: "c1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("invalid_request");
        expect(result.retryable).toBe(false);
      }
    });

    it("500 → server_error, retryable", async () => {
      fetchMock.mockResolvedValue(jsonResponse(500, {}));
      const result = await sendChannelMessage({
        channelId: "c1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("server_error");
        expect(result.retryable).toBe(true);
      }
    });

    it("statut 200 avec corps illisible (pas du JSON) → network_uncertain, pas un succès", async () => {
      fetchMock.mockResolvedValue(new Response("not json at all", { status: 200 }));
      const result = await sendChannelMessage({
        channelId: "c1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("network_uncertain");
        expect(result.retryable).toBe(true);
      }
    });

    it("statut 200 avec JSON valide mais forme inattendue (pas d'id) → network_uncertain", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { unexpected: "shape" }));
      const result = await sendChannelMessage({
        channelId: "c1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe("network_uncertain");
    });

    it("aucun contenu ni embed : rejeté avant tout appel réseau", async () => {
      const result = await sendChannelMessage({
        channelId: "c1",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe("invalid_request");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("rate limit et délai de reprise", () => {
    it("429 avec retry_after dans le corps → retryAfterMs dérivé du corps", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(429, { message: "rate limited", retry_after: 1.5, global: false }, { "Retry-After": "1" })
      );
      const result = await sendChannelMessage({
        channelId: "c1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("rate_limited");
        expect(result.retryable).toBe(true);
        expect(result.retryAfterMs).toBe(1500);
      }
    });

    it("429 sans corps exploitable → retryAfterMs dérivé de l'en-tête Retry-After", async () => {
      fetchMock.mockResolvedValue(jsonResponse(429, {}, { "Retry-After": "2" }));
      const result = await sendChannelMessage({
        channelId: "c1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.retryAfterMs).toBe(2000);
    });
  });

  describe("timeout / résultat réseau incertain", () => {
    it("fetch qui rejette (timeout/abort) → network_uncertain, retryable, jamais success", async () => {
      fetchMock.mockRejectedValue(new DOMException("The operation was aborted", "TimeoutError"));
      const result = await sendChannelMessage({
        channelId: "c1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("network_uncertain");
        expect(result.retryable).toBe(true);
      }
    });

    it("un résultat network_uncertain n'entraîne jamais de nouvelle tentative interne (fetch appelé une seule fois)", async () => {
      fetchMock.mockRejectedValue(new DOMException("The operation was aborted", "TimeoutError"));
      await sendChannelMessage({
        channelId: "c1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });
      // Le client ne boucle ni ne retente jamais lui-même — c'est à
      // l'appelant (futur exécuteur de livraison) de décider, jamais à ce
      // module. Un seul appel `fetch`, quel que soit `retryable`.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("le budget (deadline) englobe aussi la lecture du corps de réponse, pas seulement les en-têtes : une lecture qui ne se résout jamais est bornée par le même délai", async () => {
      // Simule un corps de réponse qui ne finit jamais de streamer (headers
      // reçus, mais `res.text()` ne se résout jamais) — sans l'englobement
      // explicite fetch+lecture dans la course contre le budget, cet appel
      // resterait bloqué indéfiniment au lieu de renvoyer dans le budget.
      const hangingBody = new ReadableStream<Uint8Array>({
        start() {
          /* jamais de close() ni d'enqueue() : la lecture ne se termine jamais */
        },
      });
      fetchMock.mockResolvedValue(new Response(hangingBody, { status: 200 }));

      // Juste au-dessus de MIN_REQUEST_BUDGET_MS pour que l'appel soit
      // réellement tenté, tout en gardant le test rapide.
      const deadline = new Date(NOW.getTime() + 1_100);
      const result = await sendChannelMessage({
        channelId: "c1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline,
        now: NOW,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("network_uncertain");
        expect(result.retryable).toBe(true);
      }
    }, 5000);
  });

  describe("MP composé : ouverture + envoi partagent le même deadline", () => {
    it("sendDirectMessage enchaîne ouverture puis envoi et renvoie messageId/channelId", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, { id: "dmchan1" }))
        .mockResolvedValueOnce(jsonResponse(200, { id: "msg1", channel_id: "dmchan1" }));

      const result = await sendDirectMessage({
        userId: "user1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });

      expect(result).toEqual({ ok: true, data: { messageId: "msg1", channelId: "dmchan1" } });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [firstUrl] = fetchMock.mock.calls[0];
      const [secondUrl] = fetchMock.mock.calls[1];
      expect(String(firstUrl)).toBe("https://discord.com/api/v10/users/@me/channels");
      expect(String(secondUrl)).toBe("https://discord.com/api/v10/channels/dmchan1/messages");
    });

    it("les deux appels dérivent le même budget du même deadline (jamais réinitialisé entre ouverture et envoi)", async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
      timeoutSpy.mockClear();
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, { id: "dmchan1" }))
        .mockResolvedValueOnce(jsonResponse(200, { id: "msg1", channel_id: "dmchan1" }));

      const deadline = new Date(NOW.getTime() + 7_777);
      await sendDirectMessage({
        userId: "user1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline,
        now: NOW,
      });

      expect(timeoutSpy).toHaveBeenCalledTimes(2);
      // Même `now` explicite passé aux deux appels ⇒ même budget restant
      // dérivé du même `deadline` pour les deux appels. Une implémentation
      // qui recalculerait un budget indépendant pour le second appel (au
      // lieu de propager le même `deadline`) romprait cette égalité.
      expect(timeoutSpy.mock.calls[0][0]).toBe(timeoutSpy.mock.calls[1][0]);
      expect(timeoutSpy.mock.calls[0][0]).toBeLessThanOrEqual(7_777);
    });

    it("si l'ouverture du canal échoue, l'envoi n'est jamais tenté (pas de second appel réseau)", async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(404, { code: 10013, message: "Unknown User" }));

      const result = await sendDirectMessage({
        userId: "gone",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe("not_found");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("propage l'ambiguïté de refus de MP (50007) depuis l'appel d'envoi, avec isDirectMessage forcé automatiquement", async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse(200, { id: "dmchan1" }))
        .mockResolvedValueOnce(jsonResponse(403, { code: 50007, message: "Cannot send messages to this user" }));

      const result = await sendDirectMessage({
        userId: "user1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("dm_unavailable");
        expect(result.message).toMatch(/non déterminable/);
      }
    });
  });

  describe("refus de MP — ambiguïté assumée", () => {
    it("403 code 50007 en contexte DM → dm_unavailable, non-retryable, sans prétendre connaître la cause exacte", async () => {
      fetchMock.mockResolvedValue(jsonResponse(403, { code: 50007, message: "Cannot send messages to this user" }));
      const result = await sendChannelMessage({
        channelId: "dmchan1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        isDirectMessage: true,
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("dm_unavailable");
        expect(result.retryable).toBe(false);
        // Le message ne doit jamais affirmer une cause unique et certaine.
        expect(result.message).toMatch(/non déterminable/);
      }
    });

    it("403 code 50007 HORS contexte DM (isDirectMessage non précisé) → classé permission générique, pas dm_unavailable", async () => {
      fetchMock.mockResolvedValue(jsonResponse(403, { code: 50007, message: "Cannot send messages to this user" }));
      const result = await sendChannelMessage({
        channelId: "chan1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe("auth_or_permission");
    });

    it("403 permission générique (code différent) → auth_or_permission, jamais dm_unavailable", async () => {
      fetchMock.mockResolvedValue(jsonResponse(403, { code: 50013, message: "Missing Permissions" }));
      const result = await sendChannelMessage({
        channelId: "chan1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        isDirectMessage: false,
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.kind).toBe("auth_or_permission");
        expect(result.retryable).toBe(false);
      }
    });
  });

  describe("contrôle explicite des mentions", () => {
    it("NO_MENTIONS supprime tous les pings", () => {
      expect(NO_MENTIONS).toEqual({ parse: [] });
    });

    it("transmet allowed_mentions tel quel dans le corps de requête", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { id: "m1", channel_id: "c1" }));
      await sendChannelMessage({
        channelId: "c1",
        content: "<@123> hey",
        allowedMentions: { parse: [], users: ["123"] },
        deadline: FAR_FUTURE,
        now: NOW,
      });
      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.allowed_mentions).toEqual({ parse: [], roles: undefined, users: ["123"], replied_user: undefined });
    });

    it("transmet aussi allowed_mentions (désactivées par défaut) lors d'une ÉDITION, pas seulement à la création", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { id: "m1", channel_id: "c1" }));
      await editChannelMessage({
        channelId: "c1",
        messageId: "m1",
        content: "updated",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });
      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body as string);
      // `allowedMentions` est un champ obligatoire de `MessageContentInput`
      // (pas de valeur implicite côté client) et `buildMessageBody` est
      // partagé par l'envoi ET l'édition — jamais de mentions par défaut
      // sur une édition non plus.
      expect(body.allowed_mentions).toEqual({ parse: [], roles: undefined, users: undefined, replied_user: undefined });
    });
  });

  describe("absence de fuite de token", () => {
    it("le token apparaît dans l'en-tête de requête mais jamais dans un résultat renvoyé", async () => {
      fetchMock.mockResolvedValue(jsonResponse(500, { message: "Internal Server Error" }));
      const result = await sendChannelMessage({
        channelId: "c1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });

      const [, init] = fetchMock.mock.calls[0];
      expect((init.headers as Record<string, string>).Authorization).toBe("Bot super-secret-token-value");

      expect(JSON.stringify(result)).not.toContain("super-secret-token-value");
    });

    it("le message d'erreur 'not_configured' ne contient jamais de valeur de token", async () => {
      vi.stubEnv("DISCORD_BOT_TOKEN", "");
      const result = await sendChannelMessage({
        channelId: "c1",
        content: "hi",
        allowedMentions: NO_MENTIONS,
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(JSON.stringify(result)).not.toMatch(/super-secret/);
    });
  });

  describe("chantier nettoyage réel du stockage (V2) — suppression permanente", () => {
    it("deleteThreadPermanently : DELETE /channels/{id}, sans corps, succès sur 204", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
      const result = await deleteThreadPermanently({ threadId: "thread-1", deadline: FAR_FUTURE, now: NOW });
      expect(result).toEqual({ ok: true, data: { threadId: "thread-1" } });
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe("https://discord.com/api/v10/channels/thread-1");
      expect(init.method).toBe("DELETE");
      expect(init.body).toBeUndefined();
    });

    it("deleteThreadPermanently : un fil déjà absent (404) reste honnêtement classifié not_found — JAMAIS un succès depuis ce module (la décision d'équivalence appartient au résolveur appelant)", async () => {
      fetchMock.mockResolvedValue(jsonResponse(404, { code: 10003, message: "Unknown Channel" }));
      const result = await deleteThreadPermanently({ threadId: "thread-1", deadline: FAR_FUTURE, now: NOW });
      expect(result).toEqual({
        ok: false,
        kind: "not_found",
        httpStatus: 404,
        message: expect.any(String),
        retryable: false,
      });
    });

    it("deleteThreadPermanently : permission refusée (403) — non-retryable, jamais un succès", async () => {
      fetchMock.mockResolvedValue(jsonResponse(403, { code: 50013, message: "Missing Permissions" }));
      const result = await deleteThreadPermanently({ threadId: "thread-1", deadline: FAR_FUTURE, now: NOW });
      expect(result.ok).toBe(false);
      expect(result).toMatchObject({ kind: "auth_or_permission", retryable: false });
    });

    it("deleteChannelMessage : DELETE /channels/{c}/messages/{m}, sans corps, succès sur 204", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
      const result = await deleteChannelMessage({
        channelId: "chan-1",
        messageId: "msg-1",
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result).toEqual({ ok: true, data: { channelId: "chan-1", messageId: "msg-1" } });
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe("https://discord.com/api/v10/channels/chan-1/messages/msg-1");
      expect(init.method).toBe("DELETE");
    });

    it("deleteChannelMessage : message déjà absent (404) reste honnêtement classifié not_found", async () => {
      fetchMock.mockResolvedValue(jsonResponse(404, { code: 10008, message: "Unknown Message" }));
      const result = await deleteChannelMessage({
        channelId: "chan-1",
        messageId: "msg-1",
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result).toMatchObject({ ok: false, kind: "not_found", retryable: false });
    });

    it("deleteThreadPermanently/deleteChannelMessage : aucun appel réseau tenté si le budget de bail est insuffisant", async () => {
      const almostExpired = new Date(NOW.getTime() + 500);
      const r1 = await deleteThreadPermanently({ threadId: "thread-1", deadline: almostExpired, now: NOW });
      const r2 = await deleteChannelMessage({
        channelId: "chan-1",
        messageId: "msg-1",
        deadline: almostExpired,
        now: NOW,
      });
      expect(r1).toMatchObject({ ok: false, kind: "insufficient_lease" });
      expect(r2).toMatchObject({ ok: false, kind: "insufficient_lease" });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("chantier auto-adhésion aux fils de tournois (V2) — addThreadMember non vérifié", () => {
    it("PUT /channels/{id}/thread-members/{user}, idempotent sur 204, sans revérification de type (contrairement à addThreadMemberVerified)", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
      const result = await addThreadMember({
        threadId: "thread-1",
        discordUserId: "user-1",
        deadline: FAR_FUTURE,
        now: NOW,
      });
      expect(result).toEqual({ ok: true, data: {} });
      expect(fetchMock).toHaveBeenCalledTimes(1); // aucun GET de vérification préalable
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe("https://discord.com/api/v10/channels/thread-1/thread-members/user-1");
      expect(init.method).toBe("PUT");
    });
  });

  describe("listGuildChannels", () => {
    it("garde salons texte, annonces et vocaux, triés par position", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, [
          { id: "3", name: "vocal", type: 2, position: 0 },
          { id: "2", name: "tournois", type: 0, position: 2 },
          { id: "1", name: "soirees", type: 5, position: 1 },
          { id: "4", name: "categorie", type: 4, position: 3 },
          { id: "5", name: "stage", type: 13, position: 4 },
        ])
      );
      const result = await listGuildChannels({ guildId: "333", deadline: FAR_FUTURE, now: NOW });
      expect(result).toEqual({
        ok: true,
        data: {
          channels: [
            { id: "3", name: "vocal", type: 2 },
            { id: "1", name: "soirees", type: 5 },
            { id: "2", name: "tournois", type: 0 },
            { id: "5", name: "stage", type: 13 },
          ],
        },
      });
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toBe("https://discord.com/api/v10/guilds/333/channels");
      expect(init.method).toBe("GET");
    });

    it("réponse hors format : échec explicite, jamais une liste vide présentée comme un succès", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { not: "an array" }));
      const result = await listGuildChannels({ guildId: "333", deadline: FAR_FUTURE, now: NOW });
      expect(result.ok).toBe(false);
    });
  });

  describe("verifyVoiceChannelDestination", () => {
    it.each([2, 13])("accepte le type vocal Discord %i du serveur attendu", async (type) => {
      fetchMock.mockResolvedValue(jsonResponse(200, { id: "444", guild_id: "333", type }));
      await expect(verifyVoiceChannelDestination({ channelId: "444", guildId: "333", deadline: FAR_FUTURE, now: NOW }))
        .resolves.toMatchObject({ ok: true, data: { channelId: "444" } });
    });
    it("refuse un autre serveur ou un salon non vocal", async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { id: "444", guild_id: "other", type: 2 }));
      await expect(verifyVoiceChannelDestination({ channelId: "444", guildId: "333", deadline: FAR_FUTURE, now: NOW }))
        .resolves.toMatchObject({ ok: false, kind: "destination_mismatch" });
    });
  });
});
