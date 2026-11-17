# Patch isolé — capitainerie sur `/equipes` (#370 et #408)

**Fichier de patch** : `docs/patches/20261117-equipes-capitaine-370-408.patch`
**Fichiers cibles** : `src/app/equipes/page.tsx` (affichage) et `src/lib/community-teams.ts`
(gating du recrutement) — deux fichiers, deux hunks métier + un import.
**PR propriétaires** : #370 (`feat/tower-team-rules-20261104`, tête vérifiée `9373099` le 17/11/2026, précédemment `e4778a6`) et
#408 (`codex/tower-pr-equipes-20261105`, tête vérifiée `3465c39` le 17/11/2026).
**Dépendance** : commit `171e779` de `agent/preflight-20261116`.

## Comportement incorrect

Dans le rendu de la liste, les trois lignes suivantes désignent un responsable :

```ts
const leaderId = team.captainId ?? (team.createdBy.memberships.length ? team.createdById : team.members[0]?.userId);
const leaderName = team.captain?.discordName ?? (team.createdBy.memberships.length ? team.createdBy.discordName : team.members[0]?.user.discordName ?? "aucun membre actif");
const isLeader = leaderId === user.id;
```

Quand le créateur (ou le capitaine désigné par la passation) n'est plus membre actif,
le repli `team.members[0]` promeut **le premier membre de la liste** : la capitainerie
dépend alors de l'ordre retourné par la requête, et `isLeader` accorde en plus les
boutons de gestion à ce membre arbitraire.

## Règle officielle

`src/lib/community-team-captain.ts` (commit `171e779`) :

- capitaine = `CommunityTeam.createdById` (ou `team.captainId` quand la passation de
  #370 l'a renseigné), **uniquement s'il est encore membre actif** ;
- sinon : `CAPTAIN_UNSET_LABEL` (« Capitaine non renseigné »), et personne n'est promu ;
- jamais le premier membre, jamais un tri, jamais l'ancienneté d'adhésion.

Le patch conserve la priorité à `team.captainId` apportée par #370 : il ne remplace que
le repli positionnel.

## Second fichier — `src/lib/community-teams.ts`

Le même défaut existe dans `setCommunityTeamRecruitment` : quand le capitaine
n'est plus membre actif, `leaderId` retombe sur le premier membre, qui obtient
ainsi le droit d'ouvrir ou fermer le recrutement.

Avant :

```ts
const leaderId = activeCaptain ? configuredCaptainId : team.members[0]?.userId;
if (leaderId !== userId) return "missing";
```

Après : sans capitaine actif, personne ne gère ; l'identité du capitaine ne
vient jamais d'une position dans la liste.

```ts
if (!activeCaptain) return "missing";
if (configuredCaptainId !== userId) return "missing";
```

Aucune règle d'adhésion, aucune permission Discord, aucune migration n'est
touchée : seul le repli positionnel disparaît.

## Prérequis Git

Le helper n'existe pas encore dans les branches #370/#408. Récupérer **uniquement** le
module et son test (aucun autre fichier n'est nécessaire) :

```bash
git checkout 171e779 -- src/lib/community-team-captain.ts src/lib/community-team-captain.test.ts
```

(ou `git cherry-pick 171e779` si la branche veut aussi le lot Discord `/equipe`.)

## Application et vérification

```bash
# 1. Vérifier que la cible correspond bien à la version de la branche
git apply --check docs/patches/20261117-equipes-capitaine-370-408.patch

# 2. Appliquer
git apply docs/patches/20261117-equipes-capitaine-370-408.patch

# 3. Vérifications
npx vitest run src/lib/community-team-captain.test.ts
npx tsc --noEmit
grep -n "members\[0\]" src/app/equipes/page.tsx || echo "aucun repli positionnel"
```

Le patch ne s'applique **pas** sur `agent/preflight-20261116` : cette branche n'a pas
encore reçu `team.captainId` / `team.captain` de #370, et sa page est donc plus ancienne.
Le dry-run y échoue volontairement (hunk 2), ce qui est le comportement attendu.

## Preuves de non-régression

- Dry-run `patch -p1 -F0 --dry-run` : **succès sans tolérance de contexte** sur les têtes alors relevées, revérifié le 17/11/2026 sur `9373099` (#370) et `3465c39` (#408), pour les deux fichiers — chaque paire de
  versions est identique, vérifié par `cmp`.
- Application réelle du patch sur une copie de #370 : **0 occurrence** de
  `members[0]` dans `community-teams.ts`, `teamCaptainId` bien importé et utilisé
  dans la page.
- Règle couverte par `src/lib/community-team-captain.test.ts` (10 cas : capitaine en
  dernière/troisième position, réordonnancement, capitaine non renseigné, membre
  ordinaire jamais capitaine, absence de permission dérivée).
- Cohérence Discord : `/equipe liste|moi|voir` et `/profil` lisent le même module
  (`src/lib/discord-team-commands.ts`, `src/lib/discord-community-profile.ts`).

## Ce que le patch ne touche pas

- Aucune permission, aucun rôle, aucune règle d'adhésion.
- Aucune action serveur (`./actions`), aucun formulaire, aucune migration Prisma.
- Aucune règle d'adhésion : `joinCommunityTeam` / `leaveCommunityTeam` sont intacts.
- Aucune autre ligne du rendu : noms, scores, boutons et textes inchangés.
- Il n'est **pas** appliqué automatiquement sur les branches #370/#408 : c'est à leur
  agent propriétaire de l'intégrer.
