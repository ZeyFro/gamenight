import { z } from "zod";
import { TOWER_STARTER_CHALLENGES } from "@/lib/tower-challenge-starter-catalogue";
import { TOWER_TEAM_STARTER_CHALLENGES } from "@/lib/tower-team-challenge-starter-catalogue";
import { TOWER_S1_SOLO_CHALLENGES } from "@/lib/tower-s1-solo-catalogue";
import { TOWER_S1_TEAM_CHALLENGES } from "@/lib/tower-s1-team-catalogue";

/** Contenu d'une définition : mêmes limites que `/tower-admin ajouter` et que les colonnes VarChar(120/1500). */
export const towerChallengeDefinitionContentSchema = z.object({
  title: z.string().trim().min(1).max(120),
  instructions: z.string().trim().min(1).max(1500),
  rewardFloors: z.number().int().min(1).max(20),
});

/** Ce que lisent `/tower-admin importer` (solo) et `/tower-admin importer-equipe` : packs de départ puis saison 1. */
export const TOWER_SOLO_IMPORT_PACK = [...TOWER_STARTER_CHALLENGES, ...TOWER_S1_SOLO_CHALLENGES];
export const TOWER_TEAM_IMPORT_PACK = [...TOWER_TEAM_STARTER_CHALLENGES, ...TOWER_S1_TEAM_CHALLENGES];
