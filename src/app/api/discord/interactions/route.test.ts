import { beforeEach, describe, expect, it, vi } from "vitest";

const { handle } = vi.hoisted(() => ({ handle: vi.fn() }));
vi.mock("@/lib/discord-interactions", () => ({ handleDiscordInteraction: handle }));
vi.mock("next/server", () => ({ after: vi.fn() }));

import { POST } from "./route";

/** Audit du 23/11/2026 (A05) : route publique, corps lu en entier avant la vérification de la signature. */
const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://gamenight.test/api/discord/interactions", { method: "POST", body, headers });

describe("POST /api/discord/interactions : taille du corps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handle.mockResolvedValue({ status: 200, body: { type: 1 } });
  });

  it("corps de 64 Ko ou moins : transmis à la vérification de signature", async () => {
    const response = await POST(post("x".repeat(64 * 1024), { "x-signature-ed25519": "aa", "x-signature-timestamp": "1" }));
    expect(response.status).toBe(200);
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][0]).toMatchObject({ signature: "aa", timestamp: "1" });
  });

  it("Content-Length annoncé au-delà de 64 Ko : 413 sans lire le corps ni vérifier la signature", async () => {
    const response = await POST(post("{}", { "content-length": String(64 * 1024 + 1) }));
    expect(response.status).toBe(413);
    expect(handle).not.toHaveBeenCalled();
  });

  it("corps réel au-delà de 64 Ko sans Content-Length fiable : 413", async () => {
    const response = await POST(post("x".repeat(64 * 1024 + 1)));
    expect(response.status).toBe(413);
    expect(handle).not.toHaveBeenCalled();
  });

  it("un PING Discord ordinaire passe", async () => {
    const response = await POST(post('{"type":1}', { "x-signature-ed25519": "aa", "x-signature-timestamp": "1" }));
    expect(response.status).toBe(200);
  });
});
