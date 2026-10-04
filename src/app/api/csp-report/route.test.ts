import { beforeEach, describe, expect, it, vi } from "vitest";

const { warn, checkRateLimit } = vi.hoisted(() => ({
  warn: vi.fn(),
  checkRateLimit: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn, error: vi.fn() } }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));

import { POST } from "./route";

const report = {
  "csp-report": {
    "document-uri": "https://gamenight.example/profil?token=secret#frag",
    "blocked-uri": "https://evil.example/x.js?k=v",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "source-file": "https://gamenight.example/_next/a.js?v=1",
    "line-number": 12,
    disposition: "report",
    "original-policy": "default-src 'self'",
    "script-sample": "alert(document.cookie)",
  },
};

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://example.test/api/csp-report", {
    method: "POST",
    headers: { "content-type": "application/csp-report", ...headers },
    body,
  });

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockReturnValue(true);
  vi.stubEnv("CSP_REPORT_ENABLED", "true");
});

describe("POST /api/csp-report", () => {
  it("drapeau éteint : 404, rien n'est journalisé ni compté", async () => {
    vi.stubEnv("CSP_REPORT_ENABLED", "");
    const res = await POST(post(JSON.stringify(report)));
    expect(res.status).toBe(404);
    expect(warn).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it.each(["TRUE", "1", " true"])("valeur %j : toujours éteint (seul « true » active)", async (value) => {
    vi.stubEnv("CSP_REPORT_ENABLED", value);
    expect((await POST(post(JSON.stringify(report)))).status).toBe(404);
  });

  it("rapport valide : 204 et une ligne de log réduite, sans paramètres d'URL ni script-sample", async () => {
    const res = await POST(post(JSON.stringify(report)));
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
    const meta = warn.mock.calls[0][2];
    expect(meta["document-uri"]).toBe("https://gamenight.example/profil");
    expect(meta["blocked-uri"]).toBe("https://evil.example/x.js");
    expect(meta["source-file"]).toBe("https://gamenight.example/_next/a.js");
    expect(meta["violated-directive"]).toBe("script-src-elem");
    expect(meta["line-number"]).toBe(12);
    expect(JSON.stringify(meta)).not.toContain("secret");
    expect(meta).not.toHaveProperty("script-sample");
    expect(meta).not.toHaveProperty("original-policy");
  });

  it("limite de débit atteinte : 429 sans journaliser", async () => {
    checkRateLimit.mockReturnValue(false);
    expect((await POST(post(JSON.stringify(report)))).status).toBe(429);
    expect(warn).not.toHaveBeenCalled();
  });

  it("corps trop gros (Content-Length ou contenu réel) : 413", async () => {
    expect((await POST(post("{}", { "content-length": "999999" }))).status).toBe(413);
    expect((await POST(post(JSON.stringify({ pad: "x".repeat(20_000) })))).status).toBe(413);
    expect(warn).not.toHaveBeenCalled();
  });

  it("JSON invalide : 400", async () => {
    expect((await POST(post("pas du json"))).status).toBe(400);
  });

  it("JSON inattendu : 204 mais rien n'est journalisé", async () => {
    expect((await POST(post(JSON.stringify({ autre: 1 })))).status).toBe(204);
    expect((await POST(post("[]"))).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });
});
