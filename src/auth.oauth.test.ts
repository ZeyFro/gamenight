import { Auth, type AuthConfig } from "@auth/core";
import { afterEach, describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ config: null as AuthConfig | null }));
vi.mock("next-auth", () => ({
  default: (config: AuthConfig) => {
    captured.config = config;
    return { handlers: {}, signIn: vi.fn(), signOut: vi.fn(), auth: vi.fn() };
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Discord OAuth issuer (real Auth.js callback, simulated HTTP)", () => {
  it.each([
    ["https://discord.com", true],
    ["https://foreign.example", false],
    [undefined, true],
  ])("issuer %s: accepted=%s", async (issuer, accepted) => {
    vi.stubEnv("DISCORD_CLIENT_ID", "test-client");
    vi.stubEnv("DISCORD_CLIENT_SECRET", "test-client-secret");
    await import("./auth");
    const signIn = vi.fn().mockResolvedValue(true);
    const error = vi.fn();
    const config: AuthConfig = {
      ...captured.config!,
      secret: "test-only-secret-at-least-thirty-two-characters",
      basePath: "/api/auth",
      callbacks: { signIn },
      logger: { error, warn: vi.fn(), debug: vi.fn() },
    };
    const cookieJar = new Map<string, string>();
    const request = async (path: string, init: RequestInit = {}) => {
      const response = await Auth(new Request(`https://app.example/api/auth/${path}`, {
        ...init,
        headers: { ...init.headers, cookie: [...cookieJar].map(([k, v]) => `${k}=${v}`).join("; ") },
      }), config);
      for (const cookie of response.headers.getSetCookie()) {
        const [pair] = cookie.split(";");
        const index = pair.indexOf("=");
        cookieJar.set(pair.slice(0, index), pair.slice(index + 1));
      }
      return response;
    };
    const http = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://discord.com/api/oauth2/token") {
        return Response.json({ access_token: "simulated-token", token_type: "Bearer", expires_in: 3600 });
      }
      if (url === "https://discord.com/api/users/@me") {
        return Response.json({ id: "123456789", username: "test", email: "test@example.com", avatar: null, discriminator: "0" });
      }
      throw new Error(`Unexpected HTTP request: ${url}`);
    });
    vi.stubGlobal("fetch", http);
    const csrf = await request("csrf");
    const { csrfToken } = await csrf.json();
    const authorization = await request("signin/discord", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, callbackUrl: "https://app.example/" }),
    });
    const location = new URL(authorization.headers.get("location")!);
    expect(location.origin).toBe("https://discord.com");
    expect(location.searchParams.get("code_challenge_method")).toBe("S256");
    const params = new URLSearchParams({ code: "simulated-code" });
    if (issuer !== undefined) params.set("iss", issuer);
    const callback = await request(`callback/discord?${params}`);
    expect(callback.status).toBe(302);
    if (accepted) {
      expect(callback.headers.get("location")).toBe("https://app.example/");
      expect(signIn).toHaveBeenCalledOnce();
      expect(http).toHaveBeenCalledTimes(2);
      expect(error).not.toHaveBeenCalled();
      expect([...cookieJar.keys()].some((name) => name.includes("session-token"))).toBe(true);
    } else {
      expect(callback.headers.get("location")).toContain("error=Configuration");
      expect(signIn).not.toHaveBeenCalled();
      expect(http).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalled();
      expect([...cookieJar.keys()].some((name) => name.includes("session-token"))).toBe(false);
    }
  });
});
