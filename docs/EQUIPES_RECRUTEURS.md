# Équipes : recruteurs, relance, expiration, accès et invités de tournoi

Interrupteur : `TEAM_RECRUITERS_ENABLED` (OFF par défaut, valeur exacte `true`). Migration additive `20261118130000_team_recruiters_guest`
(valeur d'enum `EXPIRED`, colonne `TeamApplication.reminderSentAt`, tables `CommunityTeamRecruiter` et `TeamTournamentGuest`).
Sans le drapeau, aucune de ces colonnes ou tables n'est lue ni écrite : le comportement de #457 est inchangé.

Prérequis : `TEAM_APPLICATIONS_ENABLED` (#457), `communityTeamsEnabled`. MP : aussi `NOTIFICATION_EXECUTOR_ENABLED` et le jeton du bot.

## Règles (décisions de Maxime du 18/11/2026)
- Le capitaine nomme **2 recruteurs au plus**, parmi les membres actifs de l'équipe (`/equipes/gestion`). Un recruteur peut se retirer lui-même.
- Capitaine ou recruteur accepte/refuse une candidature ; l'acceptation passe par `joinCommunityTeam` (transaction sérialisable : jamais plus de
  `maxMembers`, donc 8 au plus, même avec deux décideurs simultanés). Un recruteur n'a aucun autre pouvoir (ni passation, ni dissolution, ni gestion des recruteurs).
- **MP uniquement au capitaine et aux recruteurs** (nouvelle candidature, relance), jamais au candidat ni aux autres membres. Aucun appel Discord direct :
  `NotificationEvent` ADMIN / `TEAM_APPLICATION_NOTIFY` + une livraison MP par destinataire ; le résolveur revérifie à la livraison que la candidature est
  toujours en attente et que le destinataire est toujours décideur. `allowedMentions` vide.
- **Relance unique à 48 h**, **expiration à 7 jours** (statut `EXPIRED`, sans pénalité, le candidat peut repostuler : la ligne est réutilisée et `reminderSentAt` remis à zéro).
  Exécutées par `GET /api/cron/team-applications` (CRON_SECRET, 503 sans secret, aucune cadence créée par le dépôt, voir docs/CRONS.md). Si la file est éteinte, la relance n'est pas consommée.
- **Accès Discord synchronisés** (via la file d'espaces d'équipe #469, aucun appel direct) : acceptation (nouveau), départ et dissolution (déjà en place), et
  membres dont l'appartenance au serveur n'est plus ACTIVE (départ du serveur, retrait administratif) : le cron demande le retrait du rôle d'équipe (50 par passage et par communauté,
  idempotent par fenêtre de 10 minutes).
- **Invité de tournoi** : le capitaine invite un joueur actif d'une autre équipe (ou sans équipe) pour UN tournoi en inscription ; l'invité accepte ou refuse ; l'équipe principale
  de l'invité est inchangée (une seule par joueur et par communauté). Une seule invitation par (tournoi, joueur). Effectif d'un tournoi : membres + invités ≤ 8.
  Le modèle `TeamTournamentGuest` est consommé par les tournois d'équipes (PR `claude/tournois-equipes`).
- Projets et soirées d'équipe : aucune limite ajoutée (déjà illimités, #370/#469).

## Limites et choix à confirmer
- Tournoi : seuls les tournois dont `communityId` est renseigné (créés après le multi-communautés) acceptent des invités.
- Plafond « effectif de tournoi ≤ 8 invités compris » : choix de sécurité, non listé par la décision.
- Les lignes `CommunityTeamMember` des membres non actifs ne sont pas supprimées par le cron (seul l'accès Discord est retiré) ; elles ne comptent déjà plus dans les effectifs.
