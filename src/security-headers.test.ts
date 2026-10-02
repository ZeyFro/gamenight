import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

async function headersFor(source: string) {
  const rules = await nextConfig.headers!();
  const rule = rules.find((r) => r.source === source);
  expect(rule, `règle ${source}`).toBeDefined();
  return Object.fromEntries(rule!.headers.map((h) => [h.key, h.value]));
}

describe("en-têtes de sécurité (next.config)", () => {
  it("posés sur toutes les routes", async () => {
    const h = await headersFor("/:path*");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toMatch(/camera=\(\)/);
    expect(h["Permissions-Policy"]).toMatch(/microphone=\(\)/);
    expect(h["Permissions-Policy"]).toMatch(/geolocation=\(\)/);
  });

  it("CSP en Report-Only (jamais bloquante tant qu'elle n'est pas validée en réel)", async () => {
    const h = await headersFor("/:path*");
    expect(h["Content-Security-Policy"]).toBeUndefined();
    const csp = h["Content-Security-Policy-Report-Only"];
    expect(csp).toBeDefined();
    for (const directive of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-src https://www.youtube-nocookie.com",
      "worker-src 'self' blob:",
    ]) {
      expect(csp).toContain(directive);
    }
    // Connexion Discord (form POST puis redirection) et lien Steam.
    expect(csp).toMatch(/form-action [^;]*https:\/\/discord\.com/);
    expect(csp).toMatch(/form-action [^;]*https:\/\/steamcommunity\.com/);
    // Images externes (covers IGDB/Steam, avatars Discord, bannières).
    expect(csp).toMatch(/img-src [^;]*https:/);
    expect(csp).toMatch(/img-src [^;]*data:/);
  });
});
