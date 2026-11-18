import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { buildReport, formatReport, diffGrades, moderationBitsOf, GRADE_ROLES } from "../../scripts/tower-layout-diff.mjs";
import { main } from "../../scripts/tower-discord-dryrun.mjs";

const manifest = JSON.parse(readFileSync(new URL("../../docs/tower-layout-approved.json", import.meta.url), "utf8"));

type Ch = { id: string; name: string; type: number; parent_id: string | null; available_tags?: { name: string }[] };

/** Inventaire simulé : reproduit exactement ce que le manifeste attend pour les salons réutilisés. */
function inventoryFromManifest(): { channels: Ch[]; roles: unknown[] } {
  const channels: Ch[] = [];
  for (const cat of manifest.category_order) {
    if (!cat.reuse_category_id) continue;
    channels.push({ id: cat.reuse_category_id, name: cat.name, type: 4, parent_id: null });
    for (const ch of cat.channels) {
      if (ch.reuse_id) channels.push({ id: ch.reuse_id, name: ch.name, type: 0, parent_id: cat.reuse_category_id });
    }
  }
  for (const p of manifest.protected_categories) channels.push({ id: p.id, name: "protégée", type: 4, parent_id: null });
  return { channels, roles: [] };
}

describe("dry-run serveur Discord : diff", () => {
  it("liste ce qu'il faut créer sur un serveur sans les nouvelles zones", () => {
    const { channels, roles } = inventoryFromManifest();
    const report = buildReport({ manifest, channels, roles });
    const creates = report.sections.channels.filter((e: { status: string }) => e.status === "create");
    expect(creates.some((e: { label: string }) => e.label === "🗼・L'ASCENSION")).toBe(true);
    expect(creates.some((e: { label: string }) => e.label === "👑・LE SOMMET")).toBe(true);
    expect(report.writes).toBe(0);
    expect(report.counts.blocked).toBe(0);
  });

  it("signale un renommage sans rien modifier", () => {
    const { channels, roles } = inventoryFromManifest();
    channels.find((c) => c.id === "554022025753133066")!.name = "general";
    const report = buildReport({ manifest, channels, roles });
    const line = report.sections.channels.find((e: { label: string }) => e.label === "💬・général");
    expect(line).toMatchObject({ status: "rename" });
    expect(line?.detail).toContain("general");
  });

  it("bloque un salon réutilisé introuvable ou de mauvais type", () => {
    const { channels, roles } = inventoryFromManifest();
    const idx = channels.findIndex((c) => c.id === "553926084245192716");
    channels.splice(idx, 1);
    channels.find((c) => c.id === "554022025753133066")!.type = 2;
    const report = buildReport({ manifest, channels, roles });
    expect(report.counts.blocked).toBe(2);
  });

  it("compare les tags de forum et conserve les tags existants", () => {
    const { channels, roles } = inventoryFromManifest();
    const cat = channels.find((c) => c.id === "735240308882800721")!;
    channels.push({ id: "f1", name: "🔎・recherche-de-joueurs", type: 15, parent_id: cat.id, available_tags: [{ name: "PC" }, { name: "Tag maison" }] });
    const report = buildReport({ manifest, channels, roles });
    const tags = report.sections.channels.filter((e: { scope: string }) => e.scope === "tag");
    expect(tags.find((e: { label: string }) => e.label.endsWith("/ PC"))?.status).toBe("ok");
    expect(tags.find((e: { label: string }) => e.label.endsWith("/ Xbox"))?.status).toBe("create");
    expect(tags.some((e: { detail: string }) => e.detail.includes("Tag maison"))).toBe(true);
  });
});

describe("dry-run serveur Discord : grades", () => {
  it("fixe les couleurs décidées au §26", () => {
    expect(GRADE_ROLES.map((g: { name: string; colorLabel: string }) => [g.name, g.colorLabel])).toEqual([
      ["Régulars", "gris"], ["Irregular", "violet"], ["Ranker", "or"], ["High Ranker", "rouge"],
    ]);
  });

  it("propose de créer les grades absents", () => {
    const entries = diffGrades([]);
    expect(entries.map((e: { status: string }) => e.status)).toEqual(["create", "create", "create", "create"]);
  });

  it("détecte une mauvaise couleur et un droit de modération sur High Ranker, sans rien retirer", () => {
    const roles = [
      { id: "1", name: "Régulars", color: 0x95a5a6, permissions: "0" },
      { id: "2", name: "High Ranker", color: 0xf1c40f, permissions: String(BigInt(1) << BigInt(40)) },
    ];
    const entries = diffGrades(roles);
    expect(entries.find((e: { label: string; status: string }) => e.label === "Régulars")?.status).toBe("ok");
    const high = entries.filter((e: { label: string }) => e.label === "High Ranker");
    expect(high.map((e: { status: string }) => e.status).sort()).toEqual(["blocked", "rename"]);
    expect(high.find((e: { status: string }) => e.status === "blocked")?.detail).toContain("MODERATE_MEMBERS");
  });

  it("reconnaît les bits de modération et ignore les permissions ordinaires", () => {
    expect(moderationBitsOf(String(1 << 10))).toEqual([]); // VIEW_CHANNEL
    expect(moderationBitsOf(String(BigInt(8)))).toEqual(["ADMINISTRATOR"]);
  });
});

describe("dry-run serveur Discord : rôles Etage", () => {
  it("compte les rôles Etage sans proposer de suppression", () => {
    const roles = [
      { id: "10", name: "Etage 1", color: 0, permissions: "0" },
      { id: "11", name: "Étage 2", color: 0, permissions: "0" },
      { id: "12", name: "Modérateur", color: 0, permissions: "0" },
    ];
    const report = buildReport({ manifest, channels: [], roles });
    const text = formatReport(report);
    expect(report.sections.etage[0].label).toContain("2 rôle(s) Etage");
    expect(text).toContain("aucune suppression générée");
    expect(text).not.toMatch(/supprimer\b/i);
  });
});

describe("dry-run serveur Discord : sortie et CLI", () => {
  it("formate une sortie lisible avec légende et bilan", () => {
    const { channels, roles } = inventoryFromManifest();
    const text = formatReport(buildReport({ manifest, channels, roles }));
    expect(text).toContain("DRY-RUN");
    expect(text).toContain("## Catégories, salons, forums et tags");
    expect(text).toContain("+ [catégorie] 🗼・L'ASCENSION");
    expect(text).toMatch(/Bilan : \d+ conformes, \d+ à corriger, \d+ à créer, 0 bloquants, \d+ à revoir\. Écritures effectuées : 0\./);
  });

  it("hors ligne : lit un inventaire, n'appelle jamais Discord", async () => {
    const fetchImpl = vi.fn();
    const out: string[] = [];
    const inv = JSON.stringify(inventoryFromManifest());
    const code = await main({
      argv: ["--inventory", "inv.json"], env: {}, fetchImpl, out: (s: string) => out.push(s),
      readFile: async (p: string) => (p === "inv.json" ? inv : readFileSync(new URL("../../docs/tower-layout-approved.json", import.meta.url), "utf8")),
    });
    expect(code).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(out.join("\n")).toContain("Bilan");
  });

  it("--live avec Discord simulé : uniquement des GET sur channels et roles, jeton jamais affiché", async () => {
    const inv = inventoryFromManifest();
    const calls: { url: string; method: string }[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      const body = url.endsWith("/channels") ? inv.channels : inv.roles;
      return { ok: true, status: 200, json: async () => body } as Response;
    });
    const out: string[] = [];
    const err: string[] = [];
    const code = await main({
      argv: ["--live", "--json"],
      env: { DISCORD_BOT_TOKEN: "SECRET-TOKEN", DISCORD_BOT_GUILD_ID: manifest.guild_id },
      fetchImpl, out: (s: string) => out.push(s), err: (s: string) => err.push(s),
    });
    expect(code).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    expect(calls.map((c) => c.url.split("/").pop()).sort()).toEqual(["channels", "roles"]);
    expect([...out, ...err].join("\n")).not.toContain("SECRET-TOKEN");
    expect(JSON.parse(out.join("")).writes).toBe(0);
  });

  it("--live refuse un serveur différent du manifeste, sans appel", async () => {
    const fetchImpl = vi.fn();
    const err: string[] = [];
    const code = await main({ argv: ["--live"], env: { DISCORD_BOT_TOKEN: "t", DISCORD_BOT_GUILD_ID: "999" }, fetchImpl, err: (s: string) => err.push(s) });
    expect(code).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("n'offre aucun mode d'écriture : sans option, usage et aucun appel", async () => {
    const fetchImpl = vi.fn();
    const err: string[] = [];
    const code = await main({ argv: ["--apply"], env: { DISCORD_BOT_TOKEN: "t", DISCORD_BOT_GUILD_ID: manifest.guild_id }, fetchImpl, err: (s: string) => err.push(s) });
    expect(code).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(err.join("")).toContain("Aucun mode d'écriture");
  });

  it("--strict échoue tant qu'il reste des éléments à créer", async () => {
    const inv = JSON.stringify(inventoryFromManifest());
    const code = await main({ argv: ["--inventory", "i", "--strict"], env: {}, out: () => {}, readFile: async (p: string) => (p === "i" ? inv : readFileSync(new URL("../../docs/tower-layout-approved.json", import.meta.url), "utf8")) });
    expect(code).toBe(1);
  });
});
