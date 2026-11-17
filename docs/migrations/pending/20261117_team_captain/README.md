# `CommunityTeam.captainId` — migration annulée (déjà fournie par les PR)

**Ne pas appliquer de migration capitaine.** La colonne existe déjà dans les
branches #370/#408/#416 via
`prisma/migrations/20261104140000_tower_team_membership_policy/migration.sql` :

```sql
ALTER TABLE "CommunityTeam" ADD COLUMN "captainId" TEXT;
UPDATE "CommunityTeam" SET "captainId" = "createdById";
ALTER TABLE "CommunityTeam" ADD CONSTRAINT "CommunityTeam_captainId_fkey" …
```

Cette migration est absente de notre base de branche (qui s'arrête à
`20261029061000_tower_team_challenges`), d'où l'ajout manuel lors de la recette
PostgreSQL locale. Après fusion d'une des PR, `captainId` est présent et
backfillé : le SQL précédemment préparé ici aurait provoqué
`column "captainId" already exists`.

Rappels de comportement (inchangés) :
- `createdById` = créateur historique, jamais réécrit ;
- `captainId` = capitaine actuel, jamais déduit d'une position de liste ;
- sans colonne, `transferTeamCaptain` renvoie `captain_source_unavailable`.
