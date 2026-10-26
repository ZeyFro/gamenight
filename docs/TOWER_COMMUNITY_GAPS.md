# The Tower 2.0 — parcours GameNight et lacunes vérifiées

État examiné sur `origin/main` (`5bed623e53befe42f3809dfd2bd9e01126625dd4`) avec les parcours existants et le rapport Discord réel du 26 octobre 2026. Ce document décrit le code et la configuration exportée; il ne prouve ni l’activation des flags Production, ni l’activité des salons.

## À réutiliser

- **Soirées** (`Session`, `/sessions`) : proposition et vote de jeu, invitations révocables, places/capacité, sondage de disponibilités, occurrences récurrentes, rappels, checklist, présence déclarée, notes et galerie. Les accès vérifient créateur/invités et l’adhésion active à la communauté.
- **Tournois** (`Tournament`, `/tournois`) : inscription, formats individuels ou équipes, bracket et résultats; les équipes existantes appartiennent à un tournoi, pas à la communauté. Les places sont protégées contre les inscriptions concurrentes.
- **Recherche ponctuelle** (`PlayerClassified`, `/joueurs`) : jeu + texte court, visible par les membres actifs, expirant après 24 h; auteur/admin peut retirer l’annonce. Ce n’est pas un groupe persistant.
- **GameNight/Discord** : les salons existants dédiés aux soirées et tournois sont les destinations logiques. L’export indique que le salon d’annonce est un salon texte standard, pas un salon Discord de type « annonces ». Les annonces bot sont séparées par flags/config et enregistrées dans l’outbox; aucun message ne doit être envoyé par ce chantier sans configuration/activation explicite.
- **Contexte communauté** : les modèles communautaires passent par `getScopedPrisma(userId)` et exigent une adhésion ACTIVE; cette règle doit aussi protéger les équipes et projets.

## Lacune démontrée sur `main` et MVP livré

Les modèles d’équipe actuels (`TournamentTeam`, `TournamentTeamMember`) sont dépendants d’un tournoi et ne permettent pas de vivre ensemble entre plusieurs sessions ou projets. Les petites annonces expirent au bout de 24 h. Il manque donc un espace durable de recrutement et de coordination pour une guilde ou une aventure de plusieurs semaines.

MVP livré sur `codex/tower-coordinator` : fiche durable d’équipe/projet (jeu, plateforme, places, responsable, membres, recrutement ouvert/fermé), rejoindre/quitter, plafond anti-abus et contrôle de communauté active. Le formulaire de soirée existant permet à un membre de l’équipe de relier une session; l’équipe et le calendrier n’affichent que les séances déjà accessibles. Le drapeau équipes reste désactivé par défaut par communauté. Il n’y a ni message Discord, ping, XP supplémentaire ni calendrier dupliqué.

Les événements membres sont déjà couverts en partie par les créations de soirées et tournois. « Qui joue ce soir ? » continue de réutiliser `/sessions` et `/joueurs`; aucun ping automatique ou récompense d’invitation brute n’est ajouté.

## Contrôles à exécuter avant intégration

- Tests d’intégration : création par membre actif, refus hors communauté, capacité concurrente, rejoindre deux fois, départ, fermeture par non-responsable, isolation entre communautés et auteur retiré.
- Validation serveur : longueur/format des textes, nombre de places borné, état ouvert, limitation de fréquence. Aucune donnée de contact externe ni ping de masse.
- Pour le lien équipe-session livré : l’accès de session existant est conservé; seules les séances visibles via `accessibleSessionWhereFor` apparaissent et l’adhésion active est revérifiée dans la transaction de création. Aucun membre n’est inscrit automatiquement.
- Notifications Discord : désactivées par défaut; n’utiliser que l’outbox et le flag existants après configuration explicite. Une annonce de projet doit rester opt-in et limiter les mentions.
- Migrations additives uniquement. La CI doit confirmer la création, les courses concurrentes et les règles d’accès PostgreSQL avant intégration; aucune migration existante n’est modifiée.

## Limite des constats Discord

Le rapport contient 16 catégories, 37 salons texte, 19 vocaux, 197 rôles et aucun événement planifié. Il ne contient ni messages, activité, membres ni attributions de rôles. Les salons GameNight et communautaires sont conservés comme structure cible; aucune archive, fusion ou suppression n’est démontrée par ces données seules.
