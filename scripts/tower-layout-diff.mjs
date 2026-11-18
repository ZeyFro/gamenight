/**
 * The Tower 2.0 — diff PUR entre l'état attendu du serveur Discord et un inventaire.
 * Aucune E/S, aucun appel Discord, aucune écriture : fonctions déterministes testables.
 * Aucune opération « supprimer » n'existe ici : les rôles Etage sont seulement comptés.
 */
import { inspectEtageRoles } from "./tower-etage-role-rules.mjs";

/** Décisions §26 (17/11/2026) : couleurs et conditions des 4 grades. Aucun droit de modération. */
export const GRADE_ROLES = [
  { name: "Régulars", color: 0x95a5a6, colorLabel: "gris", rule: "dès l'inscription" },
  { name: "Irregular", color: 0x9b59b6, colorLabel: "violet", rule: "attribution manuelle staff (prestige, aucun droit)" },
  { name: "Ranker", color: 0xf1c40f, colorLabel: "or", rule: ">= 30 étages" },
  { name: "High Ranker", color: 0xe74c3c, colorLabel: "rouge", rule: ">= 100 étages et >= 5 défis validés sur la saison en cours" },
];

/** Tags proposés par docs/TOWER_FORUM_TAGS.md, clés = nom exact du salon forum du manifeste. */
export const FORUM_TAGS = {
  "🔎・recherche-de-joueurs": ["PC", "PlayStation", "Xbox", "Switch", "Cross-play"],
  "🛡️・recrutement-équipes": ["Débutants bienvenus", "Détente", "Compétitif", "Long terme", "Recherche capitaine"],
  "🌍・projets-et-aventures": ["Coop", "Construction", "Exploration", "Survival", "Événement"],
};

/** Bits de permission Discord qui constituent un pouvoir de modération ou d'administration. */
export const MODERATION_BITS = {
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  VIEW_AUDIT_LOG: 1n << 7n,
  MANAGE_MESSAGES: 1n << 13n,
  MENTION_EVERYONE: 1n << 17n,
  MUTE_MEMBERS: 1n << 22n,
  DEAFEN_MEMBERS: 1n << 23n,
  MOVE_MEMBERS: 1n << 24n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_THREADS: 1n << 34n,
  MODERATE_MEMBERS: 1n << 40n,
};

const TYPE_CATEGORY = 4;
const TYPE_FORUM = 15;
const TYPE_VOICE = 2;

export function expectedChannelType(channel) {
  return channel.type === "forum" ? TYPE_FORUM : channel.type === "voice_lobby" ? TYPE_VOICE : 0;
}

function typeLabel(type) {
  return { 0: "texte", 2: "vocal", 4: "catégorie", 5: "annonces", 15: "forum" }[type] ?? `type ${type}`;
}

function normalizeRoleName(name) {
  return String(name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

export function moderationBitsOf(permissions) {
  let value;
  try { value = BigInt(permissions || "0"); } catch { return ["permissions illisibles"]; }
  return Object.entries(MODERATION_BITS).filter(([, bit]) => (value & bit) !== 0n).map(([name]) => name);
}

/**
 * Statuts : ok (=), rename (~), create (+), blocked (!), review (?).
 * `create` et `rename` décrivent ce que Maxime ferait À LA MAIN ; rien n'est exécuté.
 */
function entry(status, scope, label, detail = "") {
  return { status, scope, label, detail };
}

export function diffChannels(manifest, channels) {
  const entries = [];
  const byId = new Map(channels.map((c) => [c.id, c]));
  const listed = new Set();
  for (const category of manifest.category_order) {
    let live = category.reuse_category_id ? byId.get(category.reuse_category_id) : undefined;
    if (category.reuse_category_id && (!live || live.type !== TYPE_CATEGORY)) {
      entries.push(entry("blocked", "catégorie", category.name, `catégorie attendue (id ${category.reuse_category_id}) introuvable ou de mauvais type`));
      continue;
    }
    if (!live) live = channels.find((c) => c.type === TYPE_CATEGORY && c.name === category.name);
    if (!live) {
      const policy = Array.isArray(category.permission_overwrites) ? "politique de permissions déclarée" : "politique de permissions à définir (voir plan, zone)";
      entries.push(entry("create", "catégorie", category.name, `à créer ; ${policy}`));
    } else {
      listed.add(live.id);
      entries.push(live.name === category.name
        ? entry("ok", "catégorie", category.name)
        : entry("rename", "catégorie", category.name, `nom actuel : « ${live.name} »`));
    }
    for (const ch of category.channels) {
      const wanted = expectedChannelType(ch);
      let found = ch.reuse_id ? byId.get(ch.reuse_id) : undefined;
      if (ch.reuse_id && !found) {
        entries.push(entry("blocked", "salon", ch.name, `salon existant attendu (id ${ch.reuse_id}) introuvable`));
        continue;
      }
      if (!found && live) found = channels.find((c) => c.parent_id === live.id && c.name === ch.name);
      if (!found) {
        entries.push(entry("create", "salon", ch.name, `à créer (${typeLabel(wanted)}) dans « ${category.name} »`));
        continue;
      }
      listed.add(found.id);
      const typeOk = wanted === found.type || (wanted === 0 && found.type === 5);
      if (!typeOk) {
        entries.push(entry("blocked", "salon", ch.name, `type actuel ${typeLabel(found.type)}, attendu ${typeLabel(wanted)} : pas de conversion automatique`));
        continue;
      }
      const notes = [];
      if (live && found.parent_id !== live.id) notes.push(`rangé hors de « ${category.name} » (déplacement manuel après audit des permissions)`);
      entries.push(found.name !== ch.name
        ? entry("rename", "salon", ch.name, [`nom actuel : « ${found.name} »`, ...notes].join(" ; "))
        : notes.length ? entry("review", "salon", ch.name, notes.join(" ; ")) : entry("ok", "salon", ch.name));
      if (wanted === TYPE_FORUM) {
        const expectedTags = FORUM_TAGS[ch.name] ?? [];
        const present = new Set((found.available_tags ?? []).map((t) => t.name));
        for (const tag of expectedTags) {
          entries.push(present.has(tag) ? entry("ok", "tag", `${ch.name} / ${tag}`) : entry("create", "tag", `${ch.name} / ${tag}`, "tag à ajouter"));
        }
        const extra = [...present].filter((t) => !expectedTags.includes(t));
        if (extra.length) entries.push(entry("review", "tag", ch.name, `tags existants conservés : ${extra.join(", ")}`));
      }
    }
  }
  for (const c of manifest.archive_candidates ?? []) {
    const live = byId.get(c.id);
    if (!live) entries.push(entry("review", "archive", c.name, "catégorie introuvable ; rien à faire"));
    else {
      listed.add(c.id);
      const children = channels.filter((x) => x.parent_id === c.id).length;
      entries.push(entry("review", "archive", c.name, `revue seulement : ${children} salon(s), aucun déplacement ni suppression`));
    }
  }
  for (const p of manifest.protected_categories ?? []) {
    listed.add(p.id);
    entries.push(byId.has(p.id)
      ? entry("ok", "protégée", p.reason, "intouchée")
      : entry("review", "protégée", p.reason, "introuvable dans l'inventaire"));
  }
  const unlisted = channels.filter((c) => c.type !== TYPE_CATEGORY && !listed.has(c.id) && !listed.has(c.parent_id));
  if (unlisted.length) entries.push(entry("review", "hors-plan", `${unlisted.length} salon(s) non listé(s)`, "restent intacts (principe du manifeste)"));
  return entries;
}

export function diffGrades(roles) {
  const entries = [];
  for (const grade of GRADE_ROLES) {
    const found = roles.find((r) => !r.managed && normalizeRoleName(r.name) === normalizeRoleName(grade.name));
    if (!found) {
      entries.push(entry("create", "grade", grade.name, `à créer, couleur ${grade.colorLabel}, aucune permission de modération ; condition : ${grade.rule}`));
      continue;
    }
    const bits = moderationBitsOf(found.permissions);
    if (bits.length) {
      entries.push(entry("blocked", "grade", grade.name, `porte des droits de modération (${bits.join(", ")}) : à retirer à la main après vérification des dépendances, jamais automatiquement`));
    }
    if (found.color !== grade.color) {
      entries.push(entry("rename", "grade", grade.name, `couleur ${found.color ?? 0} au lieu de ${grade.colorLabel} (#${grade.color.toString(16).padStart(6, "0")})`));
    } else if (!bits.length) {
      entries.push(entry("ok", "grade", grade.name, `couleur ${grade.colorLabel}, sans droit de modération`));
    }
  }
  return entries;
}

export function diffEtageRoles(roles, channels) {
  const found = inspectEtageRoles(roles, channels);
  const withDeps = found.filter((r) => r.dependentChannels.length > 0).length;
  const withPerms = found.filter((r) => r.hasGuildPermissions).length;
  return [
    entry("review", "rôles Etage", `${found.length} rôle(s) Etage détecté(s) (cible historique : 134)`,
      `${withDeps} avec salons dépendants, ${withPerms} avec permissions serveur ; TOUS conservés, aucune suppression générée`),
  ];
}

export function buildReport({ manifest, channels, roles }) {
  const sections = {
    channels: diffChannels(manifest, channels),
    grades: diffGrades(roles),
    etage: diffEtageRoles(roles, channels),
  };
  const all = Object.values(sections).flat();
  const counts = { ok: 0, rename: 0, create: 0, blocked: 0, review: 0 };
  for (const e of all) counts[e.status] += 1;
  return { mode: "dry-run", writes: 0, counts, sections };
}

const SYMBOL = { ok: "=", rename: "~", create: "+", blocked: "!", review: "?" };
const TITLES = { channels: "Catégories, salons, forums et tags", grades: "Grades (rôles de prestige)", etage: "Anciens rôles Etage (jamais supprimés)" };

export function formatReport(report) {
  const lines = ["The Tower — DRY-RUN : diff état attendu / inventaire", "Aucune écriture Discord. Légende : = conforme, ~ à renommer/corriger, + à créer, ! bloquant, ? à revoir à la main", ""];
  for (const [key, entries] of Object.entries(report.sections)) {
    lines.push(`## ${TITLES[key]}`);
    for (const e of entries) lines.push(`${SYMBOL[e.status]} [${e.scope}] ${e.label}${e.detail ? " — " + e.detail : ""}`);
    lines.push("");
  }
  const c = report.counts;
  lines.push(`Bilan : ${c.ok} conformes, ${c.rename} à corriger, ${c.create} à créer, ${c.blocked} bloquants, ${c.review} à revoir. Écritures effectuées : ${report.writes}.`);
  return lines.join("\n");
}
