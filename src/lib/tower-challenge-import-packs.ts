import { z } from "zod";
import { TOWER_STARTER_CHALLENGES } from "@/lib/tower-challenge-starter-catalogue";
import { TOWER_TEAM_STARTER_CHALLENGES } from "@/lib/tower-team-challenge-starter-catalogue";
import { TOWER_S1_SOLO_CHALLENGES } from "@/lib/tower-s1-solo-catalogue";
import { TOWER_S1_TEAM_CHALLENGES } from "@/lib/tower-s1-team-catalogue";
import { TOWER_VARIETY_SOLO_CHALLENGES } from "@/lib/tower-variety-catalogue";
import { towerChallengeCategoryOf } from "@/lib/tower-challenge-categories";

/** Contenu d'une définition : mêmes limites que `/tower-admin ajouter` et que les colonnes VarChar(120/1500). */
export const towerChallengeDefinitionContentSchema = z.object({
  title: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(1).max(1500),
  rewardFloors: z.number().int().min(1).max(20),
});

/** Ce que lisent `/tower-admin importer` (solo) et `/tower-admin importer-equipe` : packs de départ, saison 1, puis variété (solo). */
export const TOWER_SOLO_IMPORT_PACK: TowerImportEntry[] = [...TOWER_STARTER_CHALLENGES, ...TOWER_S1_SOLO_CHALLENGES, ...TOWER_VARIETY_SOLO_CHALLENGES];
export const TOWER_TEAM_IMPORT_PACK: TowerImportEntry[] = [...TOWER_TEAM_STARTER_CHALLENGES, ...TOWER_S1_TEAM_CHALLENGES];

export type TowerImportEntry = { title: string; instructions: string; rewardFloors: number; allowsPastProof?: boolean };

/** Ligne à créer pour une entrée de pack : catégorie de variété (§8.5) et règle de preuve (§9.1) comprises. */
export function towerImportDefinitionData(entry: TowerImportEntry) {
  return {
    title: entry.title,
    instructions: entry.instructions,
    rewardFloors: entry.rewardFloors,
    allowsPastProof: entry.allowsPastProof === true,
    category: towerChallengeCategoryOf(entry.title),
  };
}
