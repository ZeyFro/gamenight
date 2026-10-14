import { afterEach, describe, expect, it, vi } from "vitest";
import { listOAuthUserGuildIds } from "./discord-user-guilds";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("OAuth guild pagination", () => {
  const page = (count: number, offset = 0) => Array.from({ length: count }, (_, i) => ({ id: String(offset + i + 1) }));
  it.each([0, 1, 199])("%i guilds: one request", async (count) => {
    const http = vi.fn().mockResolvedValue(Response.json(page(count)));
    vi.stubGlobal("fetch", http);
    expect(await listOAuthUserGuildIds("test-token")).toHaveLength(count);
    expect(http).toHaveBeenCalledOnce();
    expect(http.mock.calls[0][0].searchParams.get("limit")).toBe("200");
    expect(http.mock.calls[0][1].headers.Authorization).toBe("Bearer test-token");
  });
  it("full page followed by short page, cursor uses largest snowflake", async () => {
    const http = vi.fn().mockResolvedValueOnce(Response.json(page(200).reverse()))
      .mockResolvedValueOnce(Response.json(page(1, 200)));
    vi.stubGlobal("fetch", http);
    expect(await listOAuthUserGuildIds("test-token")).toHaveLength(201);
    expect(http).toHaveBeenCalledTimes(2);
    expect(http.mock.calls[1][0].searchParams.get("after")).toBe("200");
  });
  it("exactly 200 needs an empty final page to prove completeness", async () => {
    const http = vi.fn().mockResolvedValueOnce(Response.json(page(200))).mockResolvedValueOnce(Response.json([]));
    vi.stubGlobal("fetch", http);
    expect(await listOAuthUserGuildIds("test-token")).toHaveLength(200);
    expect(http).toHaveBeenCalledTimes(2);
  });
  it.each([401, 403, 429, 500])("partial response then HTTP %i: no snapshot", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(page(200)))
      .mockResolvedValueOnce(new Response("sensitive body", { status })));
    await expect(listOAuthUserGuildIds("test-token")).rejects.toThrow("snapshot unavailable");
  });
  it.each([{ guilds: [] }, [{ id: "bad" }], [{ id: "1" }, { id: "1" }]])("malformed snapshot rejected: %j", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    await expect(listOAuthUserGuildIds("test-token")).rejects.toThrow();
  });
  it("non advancing cursor rejected", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json(page(200))));
    await expect(listOAuthUserGuildIds("test-token")).rejects.toThrow("Incomplete");
  });
  it("pagination cap rejected", async () => {
    let offset = 0;
    const http = vi.fn().mockImplementation(async () => { const body = page(200, offset); offset += 200; return Response.json(body); });
    vi.stubGlobal("fetch", http);
    await expect(listOAuthUserGuildIds("test-token")).rejects.toThrow("pagination limit");
    expect(http).toHaveBeenCalledTimes(25);
  });
  it("timeout rejects instead of supplying an empty snapshot", async () => {
    vi.spyOn(AbortSignal, "timeout").mockImplementationOnce(() => AbortSignal.abort());
    vi.stubGlobal("fetch", vi.fn(async (_url, { signal }) => { signal.throwIfAborted(); return Response.json([]); }));
    await expect(listOAuthUserGuildIds("test-token")).rejects.toThrow();
  });
});
