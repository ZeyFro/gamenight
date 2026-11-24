import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { upsert, after } = vi.hoisted(() => ({ upsert: vi.fn(), after: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { serverErrorLog: { upsert, findMany: vi.fn(), deleteMany: vi.fn() } } }));
vi.mock("next/server", () => ({ after }));

import {
  ERROR_MESSAGE_MAX,
  ERROR_WRITES_PER_MINUTE,
  allowErrorWrite,
  buildServerErrorEntry,
  droppedErrorWrites,
  errorFingerprint,
  persistServerError,
  resetErrorLogLimiter,
  scrubErrorMessage,
} from "./error-log";

/** Audit du 23/11/2026 (« Journaux ») : journal d'erreurs durable, sans donnée personnelle, jamais d'exception, plafonné. */
describe("scrubErrorMessage", () => {
  it("masque les URL, les identifiants de connexion, les jetons, les e-mails et les identifiants Discord", () => {
    const raw = "connect ECONNREFUSED https://admin:motdepasse@db.exemple.net:5432/prod ; Bearer abc.def-123 ; contact alice@example.com ; user 123456789012345678 ; clé 0123456789abcdef0123456789abcdef";
    const clean = scrubErrorMessage(raw);
    expect(clean).not.toMatch(/motdepasse|db\.exemple|abc\.def|alice@|123456789012345678|0123456789abcdef0123456789abcdef/);
    expect(clean).toContain("[url]");
    expect(clean).toContain("Bearer [jeton]");
    expect(clean).toContain("[e-mail]");
    expect(clean).toContain("[id]");
    expect(clean).toContain("[jeton]");
  });
  it("masque les paires « secret=valeur » et « token: valeur »", () => {
    expect(scrubErrorMessage("password=hunter2 puis token: s3cr3t-valeur")).not.toMatch(/hunter2|s3cr3t/);
  });
  it("tronque à 300 caractères au plus et replie les espaces", () => {
    const clean = scrubErrorMessage("mot ".repeat(400));
    expect(clean.length).toBeLessThanOrEqual(ERROR_MESSAGE_MAX);
    expect(clean.endsWith("…")).toBe(true);
    expect(scrubErrorMessage("a   b \n c")).toBe("a b c");
  });
});

describe("entrée et empreinte", () => {
  it("contexte, code et route restent courts ; un code Prisma ou une erreur nommée sert de code", () => {
    const prismaLike = Object.assign(new Error("Unique constraint"), { code: "P2002" });
    expect(buildServerErrorEntry("cron:reminders", prismaLike, { route: "cron/reminders" })).toEqual({
      context: "cron:reminders", code: "P2002", route: "cron/reminders", message: "Unique constraint",
    });
    expect(buildServerErrorEntry("x y z (invalide)", new TypeError("boom")).context).toBe("inconnu");
    expect(buildServerErrorEntry("cron:a", new TypeError("boom")).code).toBe("TypeError");
    expect(buildServerErrorEntry("cron:a", "texte seul").message).toBe("texte seul");
    expect(buildServerErrorEntry("cron:a", { n: 1 }).message).toBe("erreur non textuelle");
  });
  it("deux erreurs qui ne diffèrent que par un nombre ont la même empreinte (regroupement)", () => {
    const a = buildServerErrorEntry("cron:a", new Error("délai dépassé après 1532 ms"));
    const b = buildServerErrorEntry("cron:a", new Error("délai dépassé après 1710 ms"));
    const c = buildServerErrorEntry("cron:b", new Error("délai dépassé après 1532 ms"));
    expect(errorFingerprint(a)).toBe(errorFingerprint(b));
    expect(errorFingerprint(a)).not.toBe(errorFingerprint(c));
    expect(errorFingerprint(a)).toHaveLength(32);
  });
});

describe("plafond d'écriture par instance", () => {
  beforeEach(() => resetErrorLogLimiter());
  it(`autorise ${ERROR_WRITES_PER_MINUTE} écritures par minute puis compte seulement les refus`, () => {
    const results = Array.from({ length: ERROR_WRITES_PER_MINUTE + 5 }, () => allowErrorWrite(1_000));
    expect(results.filter(Boolean)).toHaveLength(ERROR_WRITES_PER_MINUTE);
    expect(droppedErrorWrites()).toBe(5);
  });
  it("la minute suivante repart de zéro", () => {
    for (let i = 0; i < ERROR_WRITES_PER_MINUTE; i++) allowErrorWrite(1_000);
    expect(allowErrorWrite(1_000)).toBe(false);
    expect(allowErrorWrite(61_000)).toBe(true);
  });
});

describe("persistServerError : ne lève jamais", () => {
  beforeEach(() => {
    resetErrorLogLimiter();
    upsert.mockReset().mockResolvedValue({});
    after.mockReset().mockImplementation((task: () => Promise<unknown>) => void task());
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("écrit en tâche de fond dans une requête (after) avec le message nettoyé", async () => {
    persistServerError("cron:reminders", new Error("échec https://secret.example/x?token=abc"), { route: "cron/reminders" });
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(after).toHaveBeenCalledTimes(1);
    const create = upsert.mock.calls[0][0].create;
    expect(create).toMatchObject({ context: "cron:reminders", route: "cron/reminders" });
    expect(create.message).not.toContain("secret.example");
  });
  it("hors requête (after refuse) : promesse gérée, écriture quand même", async () => {
    after.mockImplementation(() => { throw new Error("hors requête"); });
    persistServerError("cron:a", new Error("x"));
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
  });
  it("base en panne : aucune exception, une trace console seulement, aucune boucle", async () => {
    upsert.mockRejectedValue(new Error("base indisponible"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => persistServerError("cron:a", new Error("x"))).not.toThrow();
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(1));
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0][0]).toContain("[error-log]");
  });
  it("entrée absurde (objet circulaire, null) : jamais d'exception", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => persistServerError("cron:a", circular)).not.toThrow();
    expect(() => persistServerError("cron:a", null)).not.toThrow();
    expect(() => persistServerError("", undefined)).not.toThrow();
  });
  it("sans effet en test et sur Vercel Preview", () => {
    vi.stubEnv("NODE_ENV", "test");
    persistServerError("cron:a", new Error("x"));
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    persistServerError("cron:a", new Error("x"));
    expect(upsert).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });
  it("au-delà du plafond par minute, plus aucune écriture", async () => {
    for (let i = 0; i < ERROR_WRITES_PER_MINUTE + 10; i++) persistServerError("cron:a", new Error("x " + i));
    await vi.waitFor(() => expect(upsert).toHaveBeenCalledTimes(ERROR_WRITES_PER_MINUTE));
    expect(droppedErrorWrites()).toBe(10);
  });
});

describe("chemins critiques seulement, page admin protégée", () => {
  it("la page /admin/erreurs appelle requireAdmin avant toute lecture et renvoie un non-admin à l'accueil", () => {
    const page = readFileSync("src/app/admin/erreurs/page.tsx", "utf8");
    const guard = page.indexOf("await requireAdmin()");
    expect(guard).toBeGreaterThan(-1);
    expect(page.slice(guard, guard + 120)).toMatch(/if \(!admin\) redirect\("\/"\)/);
    expect(guard).toBeLessThan(page.indexOf("listServerErrors("));
  });
  it("le journal est appelé par les crons, le routeur d'interactions et l'échec terminal d'une livraison", () => {
    for (const file of [
      "src/app/api/cron/notification-executor/route.ts",
      "src/app/api/cron/reminders/route.ts",
      "src/app/api/cron/close-sessions/route.ts",
      "src/app/api/cron/monthly-tasks/route.ts",
      "src/lib/discord-interactions.ts",
      "src/lib/notification-delivery.ts",
    ]) expect(readFileSync(file, "utf8"), file).toContain("persistServerError(");
  });
  it("la livraison en échec n'écrit jamais le contenu ni lastError dans le journal", () => {
    const source = readFileSync("src/lib/notification-delivery.ts", "utf8");
    const start = source.indexOf("persistServerError(\"notification-executor\"");
    expect(source.slice(start, start + 260)).not.toMatch(/lastError|content|body/);
  });
  it("la purge à 30 jours est branchée au cron quotidien monthly-tasks", () => {
    expect(readFileSync("src/app/api/cron/monthly-tasks/route.ts", "utf8")).toContain("purgeServerErrors()");
  });
});
