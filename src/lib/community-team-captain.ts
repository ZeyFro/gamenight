/**
 * Capitainerie d'une équipe — règle PURE, une seule source pour Discord et
 * GameNight.
 *
 * Source métier qui fait autorité : `CommunityTeam.createdById`, c'est-à-dire
 * le créateur de l'équipe, déjà affiché « Responsable » sur `/equipes`. Il
 * n'existe aujourd'hui AUCUN champ ni rôle « capitaine » dédié dans
 * `CommunityTeam` / `CommunityTeamMember` : la capitainerie n'est donc jamais
 * un attribut d'adhésion, et surtout jamais une position dans une liste.
 *
 * Interdits tenus ici (et vérifiés par test) :
 * - pas de premier membre de liste, pas de tri alphabétique ou numérique ;
 * - pas d'ancienneté d'adhésion ni d'ordre de création des adhésions ;
 * - pas de repli arbitraire quand le créateur n'est plus membre : on affiche
 *   « Capitaine non renseigné » plutôt que d'inventer un responsable ;
 * - aucune permission, aucun droit de gestion n'est déduit de la capitainerie
 *   par ce module : il ne renvoie qu'une identité.
 *
 * LIMITE CONNUE, hors de ce fichier : `src/app/equipes/page.tsx` promeut encore
 * le premier membre de la liste quand le créateur n'est plus membre actif. Ce
 * fichier appartient aux PR #370 et #408 (passation de capitaine) : il n'est
 * pas modifié ici pour ne pas écraser leur travail, et la correction attendue
 * y est décrite dans `docs/obsidian/DISCORD-equipe-v1.md`.
 */

export interface TeamCaptainSource {
  /** `CommunityTeam.createdById` — la seule source de vérité. */
  createdById: string | null | undefined;
  /** Identifiants des membres ACTIFS de l'équipe, dans un ordre quelconque. */
  activeMemberIds: readonly string[];
}

export type TeamCaptain = { kind: "CAPTAIN"; userId: string } | { kind: "NONE" };

/** Libellé neutre imposé quand aucun capitaine ne peut être établi. */
export const CAPTAIN_UNSET_LABEL = "Capitaine non renseigné";

/**
 * Le créateur est capitaine uniquement s'il est encore membre actif de son
 * équipe. Sinon : aucun capitaine — jamais le membre suivant.
 * L'ordre de `activeMemberIds` n'a aucune influence.
 */
export function resolveTeamCaptain(team: TeamCaptainSource): TeamCaptain {
  const creator = team.createdById;
  if (!creator) return { kind: "NONE" };
  return team.activeMemberIds.includes(creator) ? { kind: "CAPTAIN", userId: creator } : { kind: "NONE" };
}

/** Vrai seulement pour le créateur encore membre actif. */
export function isTeamCaptain(team: TeamCaptainSource, userId: string): boolean {
  const captain = resolveTeamCaptain(team);
  return captain.kind === "CAPTAIN" && captain.userId === userId;
}

/** Identifiant du capitaine, ou `null` s'il n'y en a pas. */
export function teamCaptainId(team: TeamCaptainSource): string | null {
  const captain = resolveTeamCaptain(team);
  return captain.kind === "CAPTAIN" ? captain.userId : null;
}
