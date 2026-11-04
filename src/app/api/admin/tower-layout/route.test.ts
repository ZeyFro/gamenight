import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

describe("The Tower: layout Preview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("Preview bloque POST avant tout appel Discord", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    const response = await POST(new NextRequest("http://localhost/api/admin/tower-layout", { method: "POST" }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "preview_disabled" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
