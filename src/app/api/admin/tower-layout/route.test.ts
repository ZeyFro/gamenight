import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.currentUser }));
vi.mock("@/lib/admin", () => ({ requireAdmin: mocks.admin }));

import { POST } from "./route";

describe("The Tower: layout Preview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("Preview bloque POST avant authentification et tout appel Discord", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);

    const response = await POST({} as never);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "preview_disabled" });
    expect(mocks.currentUser).not.toHaveBeenCalled();
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
