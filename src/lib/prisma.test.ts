import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ client: vi.fn(), neon: vi.fn() }));
vi.mock("@prisma/client", () => ({ PrismaClient: class { constructor(options: unknown) { mocks.client(options); } } }));
vi.mock("@prisma/adapter-neon", () => ({ PrismaNeon: class { constructor(options: unknown) { mocks.neon(options); } } }));

describe("destination Prisma de recette locale", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    delete (globalThis as { prisma?: unknown }).prisma;
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "postgresql://unused.invalid/app");
    vi.stubEnv("TEST_DATABASE_URL", "");
  });
  afterEach(() => {
    delete (globalThis as { prisma?: unknown }).prisma;
    vi.unstubAllEnvs();
  });

  it.each(["127.0.0.1", "localhost", "[::1]"])("connecte directement la base de recette sur %s", async host => {
    const url = ["postgresql:", `//postgres:test@${host}:55440/gamenight_portable1_test`].join("");
    vi.stubEnv("TEST_DATABASE_URL", url);
    await import("./prisma");
    expect(mocks.client).toHaveBeenCalledWith({ datasourceUrl: url });
    expect(mocks.neon).not.toHaveBeenCalled();
  });

  it.each(["postgresql://remote.invalid/test", "https://127.0.0.1/test", "not-a-url"])("refuse une destination de recette non locale : %s", async url => {
    vi.stubEnv("TEST_DATABASE_URL", url);
    await expect(import("./prisma")).rejects.toThrow();
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it("ignore TEST_DATABASE_URL en production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("TEST_DATABASE_URL", "postgresql://127.0.0.1/test");
    await import("./prisma");
    expect(mocks.neon).toHaveBeenCalledWith({ connectionString: "postgresql://unused.invalid/app" });
    expect(mocks.client).toHaveBeenCalledWith({ adapter: expect.anything() });
  });

  it("conserve Neon sans base de recette explicite", async () => {
    await import("./prisma");
    expect(mocks.neon).toHaveBeenCalledWith({ connectionString: "postgresql://unused.invalid/app" });
  });
});
