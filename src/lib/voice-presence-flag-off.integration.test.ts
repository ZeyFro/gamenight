import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Code déployé AVANT les migrations vocales : VOICE_PRESENCE_ENABLED éteint = aucune requête sur les tables vocales.
 * AUTONOME : à partir de TEST_DATABASE_URL (Postgres local jetable, base `gamenight_*`), crée une base dédiée
 * `gamenight_legacy_<horodatage>`, y applique `prisma/migrations` SANS les 4 migrations vocales, exécute les scénarios
 * sur CETTE base uniquement (jamais de TRUNCATE sur TEST_DATABASE_URL), puis supprime la base et le dossier temporaire.
 * Aucun ref git requis (checkout superficiel de la CI). Suite SKIPPÉE si TEST_DATABASE_URL est absente.
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const VOICE_MIGRATIONS = [
  "20261020150000_session_voice_presence",
  "20261022120000_voice_presence_consent_coordination",
  "20261022130000_voice_presence_retention_gap_bounds",
  "20261022140000_voice_presence_gap_history",
];
const holder = vi.hoisted(() => ({ url: "" }));

/** Refuse tout ce qui n'est pas un Postgres local jetable `gamenight_*`. */
function assertLocalTestUrl(raw: string) {
  const url = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("TEST_DATABASE_URL: protocole refusé");
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("TEST_DATABASE_URL: hôte refusé (127.0.0.1/localhost seulement)");
  if (!url.pathname.slice(1).startsWith("gamenight_")) throw new Error("TEST_DATABASE_URL: le nom de base doit commencer par gamenight_");
  return url;
}

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: holder.url ? new PrismaClient({ datasourceUrl: holder.url }) : ({} as unknown) };
});
vi.mock("@/lib/current-user", () => ({ getCurrentUser: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

if (!TEST_DATABASE_URL) console.warn("[voice-presence-flag-off] TEST_DATABASE_URL absente : suite IGNOREE (skipped).");

describe.skipIf(!TEST_DATABASE_URL)("drapeau vocal éteint sur un schéma sans tables vocales (base dédiée créée par le test)", () => {
  let admin: import("@prisma/client").PrismaClient | null = null;
  let db: import("@prisma/client").PrismaClient;
  let legacyName = "";
  let workDir = "";
  let sessionsLib: typeof import("./sessions");
  let presence: typeof import("./session-voice-presence");
  let retention: typeof import("./retention-runner");
  let actions: typeof import("@/app/sessions/actions/voice-presence");
  let adminPage: typeof import("@/app/admin/voice-presence/page");
  let n = 0;

  beforeAll(async () => {
    const base = assertLocalTestUrl(TEST_DATABASE_URL!);
    const { PrismaClient } = await import("@prisma/client");
    admin = new PrismaClient({ datasourceUrl: base.toString() });
    legacyName = `gamenight_legacy_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await admin.$executeRawUnsafe(`CREATE DATABASE "${legacyName}"`);

    workDir = mkdtempSync(path.join(tmpdir(), "gn-legacy-"));
    mkdirSync(path.join(workDir, "prisma"));
    cpSync(path.join(process.cwd(), "prisma", "migrations"), path.join(workDir, "prisma", "migrations"), {
      recursive: true,
      filter: source => !VOICE_MIGRATIONS.includes(path.basename(source)),
    });
    cpSync(path.join(process.cwd(), "prisma", "schema.prisma"), path.join(workDir, "prisma", "schema.prisma"));
    for (const name of VOICE_MIGRATIONS) expect(existsSync(path.join(workDir, "prisma", "migrations", name))).toBe(false);

    const legacy = new URL(base.toString());
    legacy.pathname = `/${legacyName}`;
    holder.url = legacy.toString();
    const deploy = spawnSync(process.execPath, [path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"), "migrate", "deploy", "--schema", path.join(workDir, "prisma", "schema.prisma")], {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: holder.url },
    });
    if (deploy.status !== 0) throw new Error(`prisma migrate deploy a échoué (code ${deploy.status}) : ${deploy.stderr.slice(0, 500)}`);

    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    expect(await db.$queryRaw<unknown[]>`SELECT to_regclass('"SessionVoicePresenceControl"')::text AS t`).toEqual([{ t: null }]);
    sessionsLib = await import("./sessions");
    presence = await import("./session-voice-presence");
    retention = await import("./retention-runner");
    actions = await import("@/app/sessions/actions/voice-presence");
    adminPage = await import("@/app/admin/voice-presence/page");
  }, 240_000);

  afterAll(async () => {
    await db?.$disconnect().catch(() => undefined);
    if (admin && legacyName) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${legacyName}" WITH (FORCE)`);
    await admin?.$disconnect();
    // Dossier créé par ce test : copies simples, aucun lien. Windows peut le retenir un instant (EPERM) : réessais, et un
    // échec est signalé sans masquer le résultat des tests.
    if (workDir) {
      try { rmSync(workDir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 }); }
      catch (error) { console.warn(`[flag-off] nettoyage de ${workDir} impossible : ${(error as NodeJS.ErrnoException).code}`); }
    }
  }, 60_000);

  beforeEach(async () => {
    vi.stubEnv("VOICE_PRESENCE_ENABLED", "");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    // Uniquement la base dédiée (holder.url), jamais TEST_DATABASE_URL.
    await db.$executeRawUnsafe(`TRUNCATE "NotificationDelivery", "NotificationEvent", "Session", "Game", "User", "GroupSessionStats", "GroupGameStat", "GroupActiveWeek" CASCADE`);
  }, 60_000);

  async function seed(status: "VOTING" | "SCHEDULED") {
    n += 1;
    const user = await db.user.create({ data: { discordId: `legacy-${n}`, discordName: `legacy-${n}` } });
    const { getDefaultCommunityId } = await import("@/lib/default-community");
    const communityId = await getDefaultCommunityId();
    await db.membership.create({ data: { userId: user.id, communityId, status: "ACTIVE" } });
    const session = await db.session.create({
      data: { date: new Date("2026-09-20T20:00:00.000Z"), status, createdById: user.id, communityId },
    });
    return { user, session };
  }
  const form = (sessionId: string) => { const data = new FormData(); data.set("sessionId", sessionId); return data; };

  it("lit la page de soirée sans toucher aux tables vocales (panneau désactivé)", async () => {
    const { user, session } = await seed("SCHEDULED");
    expect(await presence.readSessionVoicePresence(session.id, user.id))
      .toMatchObject({ enabled: false, consented: false, canConsent: false, entries: [], gapPeriods: [] });
  }, 60_000);

  it("annule une soirée sans erreur", async () => {
    const { session } = await seed("VOTING");
    await sessionsLib.cancelSession(session.id);
    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("CANCELLED");
  }, 60_000);

  it("clôture une soirée (markSessionDone) sans erreur", async () => {
    const { session } = await seed("SCHEDULED");
    await sessionsLib.markSessionDone(session.id);
    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("DONE");
  }, 60_000);

  it("exécute la rétention (dry-run et réel) sans passer par les tables vocales", async () => {
    for (const dryRun of [true, false]) {
      const report = await retention.runRetentionCleanup({ dryRun });
      expect(report.errors.filter(error => error.startsWith("voicePresence"))).toEqual([]);
      expect(report.voicePresence).toBeNull();
    }
  }, 60_000);

  it("le retrait de consentement redirige (voice=disabled) sans requête vocale ni lecture de l'utilisateur", async () => {
    const { session } = await seed("SCHEDULED");
    const { getCurrentUser } = await import("@/lib/current-user");
    await expect(actions.withdrawVoicePresenceConsentAction(form(session.id))).rejects.toThrow(/NEXT_REDIRECT/);
    await expect(actions.withdrawVoicePresenceConsentAction(form(session.id))).rejects.toMatchObject({ digest: expect.stringContaining("voice=disabled") });
    expect(getCurrentUser).not.toHaveBeenCalled();
  }, 60_000);

  it("la page admin des durées vocales répond notFound avant toute requête", async () => {
    await expect(adminPage.default()).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  }, 60_000);

  // Contrôle négatif : drapeau allumé sur le même schéma sans tables vocales => les accès échouent.
  it("contrôle négatif : drapeau à true => lecture et annulation échouent faute de tables vocales", async () => {
    vi.stubEnv("VOICE_PRESENCE_ENABLED", "true");
    const { user, session } = await seed("VOTING");
    await expect(presence.readSessionVoicePresence(session.id, user.id)).rejects.toThrow();
    await expect(sessionsLib.cancelSession(session.id)).rejects.toThrow();
  }, 60_000);
});
