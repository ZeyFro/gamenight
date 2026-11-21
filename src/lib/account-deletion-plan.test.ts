import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_NAME,
  JSON_SCRUB_COLUMNS,
  NON_FK_PLAN,
  TEXT_SCRUB_COLUMNS,
  USER_COLUMNS_KEPT,
  USER_RELATION_PLAN,
  isTombstoneDiscordId,
  modelAccessor,
  planEntries,
  scrubJsonValue,
  scrubNeedles,
  tombstoneDiscordId,
  tombstoneUserData,
} from "@/lib/account-deletion-plan";

/**
 * Garde-fou de la suppression de compte : le classement (`account-deletion-plan.ts`) doit couvrir EXACTEMENT les
 * relations vers `User` et les champs-identifiants du schéma. Une nouvelle relation non classée fait échouer ce
 * test : l'auteur choisit alors DELETE / KEEP / CUSTOM avec sa raison, au lieu de laisser une donnée personnelle
 * survivre à une suppression de compte (ou une suppression échouer sur une clé étrangère).
 */

interface Field {
  name: string;
  type: string;
  optional: boolean;
  list: boolean;
  attributes: string;
}

const schema = readFileSync(join(__dirname, "..", "..", "prisma", "schema.prisma"), "utf8");

const models = new Map<string, Field[]>();
{
  let current: Field[] | null = null;
  for (const line of schema.split("\n")) {
    const start = line.match(/^model (\w+) \{/);
    if (start) {
      current = [];
      models.set(start[1], current);
      continue;
    }
    if (/^\}/.test(line)) {
      current = null;
      continue;
    }
    if (!current) continue;
    const field = line.match(/^\s+(\w+)\s+(\w+)(\[\])?(\?)?(\s.*)?$/);
    if (field && !line.trim().startsWith("//") && !line.trim().startsWith("@@")) {
      current.push({ name: field[1], type: field[2], list: Boolean(field[3]), optional: Boolean(field[4]), attributes: field[5] ?? "" });
    }
  }
}

function relationFk(field: Field): { fields: string[]; onDelete: string } | null {
  const match = field.attributes.match(/@relation\(([^)]*)\)/);
  if (!match || !/fields:\s*\[/.test(match[1])) return null;
  const fields = (match[1].match(/fields:\s*\[([^\]]*)\]/)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const explicit = match[1].match(/onDelete:\s*(\w+)/)?.[1];
  return { fields, onDelete: explicit ?? (field.optional ? "SetNull" : "Restrict") };
}

/** Relations vers `User` avec clé étrangère : `Modèle.champ` (premier champ de la clé). */
const userForeignKeys = new Map<string, { onDelete: string }>();
for (const [model, fields] of models) {
  if (model === "User") continue;
  for (const field of fields) {
    if (field.type !== "User") continue;
    const fk = relationFk(field);
    if (!fk) throw new Error(`Relation vers User sans clé étrangère lisible : ${model}.${field.name}`);
    userForeignKeys.set(`${model}.${fk.fields[0]}`, { onDelete: fk.onDelete });
  }
}

describe("classement des relations vers User", () => {
  it("lit bien les relations du schéma (garde contre un parseur vide)", () => {
    expect(userForeignKeys.size).toBeGreaterThanOrEqual(120);
    expect(models.has("User")).toBe(true);
  });

  it("chaque relation vers User est classée", () => {
    const missing = [...userForeignKeys.keys()].filter((key) => !(key in USER_RELATION_PLAN)).sort();
    expect(missing, `Relations à classer dans account-deletion-plan.ts : ${missing.join(", ")}`).toEqual([]);
  });

  it("aucune entrée du classement ne désigne une relation disparue", () => {
    const stale = Object.keys(USER_RELATION_PLAN).filter((key) => !userForeignKeys.has(key)).sort();
    expect(stale).toEqual([]);
  });

  it("chaque entrée porte une raison lisible", () => {
    for (const [key, rule] of Object.entries(USER_RELATION_PLAN)) {
      expect(rule.reason.length, key).toBeGreaterThan(10);
    }
  });

  it("le seul traitement à part est celui des défis Tower, géré explicitement par l'exécuteur", () => {
    expect(planEntries("CUSTOM").map((entry) => `${entry.model}.${entry.field}`)).toEqual(["TowerChallengeAttempt.userId"]);
  });

  it("toute relation en Restrict ou NoAction est CONSERVÉE (la ligne User n'est jamais supprimée) ou supprimée explicitement", () => {
    const restricted = [...userForeignKeys].filter(([, v]) => v.onDelete === "Restrict" || v.onDelete === "NoAction").map(([key]) => key);
    expect(restricted.length).toBeGreaterThanOrEqual(15);
    for (const key of restricted) expect(["KEEP", "DELETE"], key).toContain(USER_RELATION_PLAN[key].action);
  });
});

describe("suppression sans violation de clé étrangère", () => {
  /** Relations entrantes vers `model` (clé étrangère portée par un autre modèle) qui bloqueraient sa suppression. */
  function blockingInbound(model: string): string[] {
    const blocking: string[] = [];
    for (const [other, fields] of models) {
      for (const field of fields) {
        if (field.type !== model) continue;
        const fk = relationFk(field);
        if (fk && (fk.onDelete === "Restrict" || fk.onDelete === "NoAction")) blocking.push(`${other}.${field.name}`);
      }
    }
    return blocking;
  }

  it("aucun modèle supprimé n'est référencé en Restrict/NoAction (sauf défis Tower, traités avant)", () => {
    const targets = new Set([...planEntries("DELETE").map((e) => e.model), ...Object.entries(NON_FK_PLAN).filter(([, r]) => r.action === "DELETE").map(([k]) => k.split(".")[0])]);
    const blocked = [...targets].flatMap((model) => blockingInbound(model).map((ref) => `${model} ← ${ref}`)).sort();
    expect(blocked).toEqual([]);
  });

  it("les défis Tower ne sont référencés en NoAction que par les recours, supprimés avant", () => {
    expect(blockingInbound("TowerChallengeAttempt")).toEqual(["TowerChallengeAppeal.attempt"]);
  });

  it("les modèles et champs du classement existent, et chaque champ désigne une colonne scalaire", () => {
    const entries = [
      ...Object.keys(USER_RELATION_PLAN),
      ...Object.keys(NON_FK_PLAN),
    ];
    for (const key of entries) {
      const [model, field] = key.split(".");
      const fields = models.get(model);
      expect(fields, `modèle ${model}`).toBeDefined();
      expect(fields?.some((f) => f.name === field), key).toBe(true);
    }
    for (const { model, columns } of TEXT_SCRUB_COLUMNS) {
      for (const column of columns) expect(models.get(model)?.some((f) => f.name === column && f.type === "String"), `${model}.${column}`).toBe(true);
    }
    for (const { model, column } of JSON_SCRUB_COLUMNS) expect(models.get(model)?.some((f) => f.name === column && f.type === "Json"), `${model}.${column}`).toBe(true);
  });
});

describe("classement des identifiants sans clé étrangère", () => {
  const IDENTIFIER_NAME = /(user|discordid|actor|author|reporter|voter|reviewer|arbiter|requester|installedby|activatedby|adminid|adminname|payload)/i;
  const EXTRA = ["MonthlyRecap.data"];

  const candidates: string[] = [];
  for (const [model, fields] of models) {
    if (model === "User") continue;
    const fkColumns = new Set(
      fields.filter((f) => f.type === "User").flatMap((f) => relationFk(f)?.fields ?? [])
    );
    for (const field of fields) {
      if ((field.type !== "String" && field.type !== "Json") || fkColumns.has(field.name)) continue;
      if (IDENTIFIER_NAME.test(field.name)) candidates.push(`${model}.${field.name}`);
    }
  }
  candidates.push(...EXTRA);

  it("détecte des champs (garde contre un scan vide)", () => {
    expect(candidates.length).toBeGreaterThan(20);
  });

  it("chaque champ-identifiant sans clé étrangère est classé, directement ou parmi les relations", () => {
    const missing = candidates.filter((key) => !(key in NON_FK_PLAN) && !(key in USER_RELATION_PLAN)).sort();
    expect(missing, `Champs à classer dans NON_FK_PLAN : ${missing.join(", ")}`).toEqual([]);
  });
});

describe("anonymisation de la ligne User", () => {
  const modelNames = new Set(models.keys());
  const scalarColumns = (models.get("User") ?? []).filter((f) => !modelNames.has(f.type) && !f.attributes.includes("@relation")).map((f) => f.name);

  it("chaque colonne scalaire de User est neutralisée ou explicitement conservée", () => {
    expect(scalarColumns).toContain("discordId");
    const handled = new Set([...Object.keys(tombstoneUserData("u1", new Date(0))), ...Object.keys(USER_COLUMNS_KEPT)]);
    const unhandled = scalarColumns.filter((column) => !handled.has(column));
    expect(unhandled, `Colonnes de User à traiter dans tombstoneUserData ou USER_COLUMNS_KEPT : ${unhandled.join(", ")}`).toEqual([]);
  });

  it("aucune colonne désignée n'a disparu du schéma", () => {
    const known = new Set(scalarColumns);
    const stale = [...Object.keys(tombstoneUserData("u1", new Date(0))), ...Object.keys(USER_COLUMNS_KEPT)].filter((column) => !known.has(column));
    expect(stale).toEqual([]);
  });

  it("le compte anonymisé n'a plus d'identité et invalide les sessions", () => {
    const now = new Date("2026-11-21T10:00:00Z");
    const data = tombstoneUserData("cuid1", now);
    expect(data.discordId).toBe("deleted:cuid1");
    expect(data.discordName).toBe(ANONYMOUS_NAME);
    expect(data.discordAvatar).toBeNull();
    expect(data.discordRefreshToken).toBeNull();
    expect(data.forceReloginAt).toEqual(now);
    expect(data.steamId64).toBeNull();
  });
});

describe("neutralisation de texte", () => {
  it("remplace les chaînes JSON qui contiennent le pseudo ou l'identifiant, jamais les clés", () => {
    const input = { Max: 1, title: "Soirée de Max", mention: "<@123456789012345678>", nested: [{ by: "Max" }, 3, null, true] };
    const { value, changed } = scrubJsonValue(input, ["123456789012345678", "Max"], ANONYMOUS_NAME);
    expect(changed).toBe(true);
    expect(value).toEqual({
      Max: 1,
      title: `Soirée de ${ANONYMOUS_NAME}`,
      mention: `<@${ANONYMOUS_NAME}>`,
      nested: [{ by: ANONYMOUS_NAME }, 3, null, true],
    });
  });

  it("ne signale aucun changement quand rien ne correspond, et ignore les aiguilles vides", () => {
    expect(scrubJsonValue({ a: "b" }, ["zzz", ""], ANONYMOUS_NAME)).toEqual({ value: { a: "b" }, changed: false });
  });

  it("ne cherche pas un pseudo de moins de 3 caractères", () => {
    expect(scrubNeedles({ discordId: "1", discordName: "Al" })).toEqual(["1"]);
    expect(scrubNeedles({ discordId: "1", discordName: "Alice" })).toEqual(["1", "Alice"]);
  });

  it("le compte anonymisé se reconnaît à son préfixe, jamais confondu avec un identifiant Discord", () => {
    const id = tombstoneDiscordId("cuid123");
    expect(isTombstoneDiscordId(id)).toBe(true);
    expect(isTombstoneDiscordId("123456789012345678")).toBe(false);
    expect(modelAccessor("TowerChallengeAttempt")).toBe("towerChallengeAttempt");
  });
});
