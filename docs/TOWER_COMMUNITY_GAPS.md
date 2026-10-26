# The Tower 2.0 — parcours GameNight et lacunes vérifiées

État examiné sur `origin/main` (`5bed623e53befe42f3809dfd2bd9e01126625dd4`) avec les parcours existants et le rapport Discord réel du 26 octobre 2026. Ce document décrit le code et la configuration exportée; il ne prouve ni l’activation des flags Production, ni l’activité des salons.

## À réutiliser

- **Soirées** (`Session`, `/sessions`) : proposition et vote de jeu, invitations révocables, places/capacité, sondage de disponibilités, occurrences récurrentes, rappels, checklist, présence déclarée, notes et galerie. Les accès vérifient créateur/invités et l’adhésion active à la communauté.
- **Tournois** (`Tournament`, `/tournois`) : inscription, formats individuels ou équipes, bracket et résultats; les équipes existantes appartiennent à un tournoi, pas à la communauté. Les places sont protégées contre les inscriptions concurrentes.
- **Recherche ponctuelle** (`PlayerClassified`, `/joueurs`) : jeu + texte court, visible par les membres actifs, expirant après 24 h; auteur/admin peut retirer l’annonce. Ce n’est pas un groupe persistant.
- **GameNight/Discord** : les salons exportés `🎮-soirées` (`1557465643849220126`) et `🏆tournois` (`1557465648748302336`) sont déjà les destinations logiques. L’export indique `⚙️annonce` (`1557685767151820851`) comme salon texte, pas comme type « annonces » Discord. Les annonces bot sont déjà séparées par flags/config et enregistrées dans l’outbox; aucun message ne doit être envoyé par ce chantier sans configuration/activation explicite.
- **Contexte communauté** : les modèles communautaires passent par `getScopedPrisma(userId)` et exigent une adhésion ACTIVE; cette règle doit aussi protéger les équipes et projets.

## Lacune démontrée et MVP recommandé

Les modèles d’équipe actuels (`TournamentTeam`, `TournamentTeamMember`) sont dépendants d’un tournoi et ne permettent pas de vivre ensemble entre plusieurs sessions ou projets. Les petites annonces expirent au bout de 24 h. Il manque donc un espace durable de recrutement et de coordination pour une guilde ou une aventure de plusieurs semaines.

MVP suivant, sans nouveaux messages Discord ni salon externe : une fiche de projet d’équipe dans l’application (jeu, titre, description, plateforme, places souhaitées, responsable, ouvert/fermé, membres et échéance), avec rejoindre/quitter et fermeture par le responsable. Réutiliser les fiches jeu, communauté active, composants de formulaire et règles d’autorisation existants. Lier les premières sessions au projet peut venir après validation de ce MVP; ne pas dupliquer calendrier, tournois ou annonces.

Les événements membres sont déjà couverts en partie par les créations de soirées et tournois. Le manque ne justifie pas un troisième calendrier : relier une équipe à une soirée existante suffit pour une première coordination. « Qui joue ce soir ? » peut réutiliser `/sessions` et `/joueurs`; éviter un ping automatique ou une récompense pour invitation brute.

## Contrôles à prévoir avant le code et la mise en service

- Tests d’intégration : création par membre actif, refus hors communauté, capacité concurrente, rejoindre deux fois, départ, fermeture par non-responsable, isolation entre communautés et auteur retiré.
- Validation serveur : longueur/format des textes, nombre de places borné, état ouvert, limitation de fréquence. Aucune donnée de contact externe ni ping de masse.
- Si les sessions sont liées plus tard : vérifier l’accès via l’équipe et la communauté, conserver le contrôle `SessionInvite`, et ne pas inscrire automatiquement un membre à une soirée.
- Notifications Discord : désactivées par défaut; n’utiliser que l’outbox et le flag existants après configuration explicite. Une annonce de projet doit rester opt-in et limiter les mentions.
- Migration additive seulement si une table durable est retenue; sauvegarde et test PostgreSQL isolé avant intégration. Pas de migration existante modifiée.

## Limite des constats Discord

Le rapport contient 16 catégories, 37 salons texte, 19 vocaux, 197 rôles et aucun événement planifié. Il ne contient ni messages, activité, membres ni attributions de rôles. Les salons GameNight et communautaires sont conservés comme structure cible; aucune archive, fusion ou suppression n’est démontrée par ces données seules.
