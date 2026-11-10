# Index de la documentation

## Démarrer et développer

- [README](../README.md) — présentation, fonctions et stack.
- [Développement local](DEVELOPPEMENT_LOCAL.md) — PostgreSQL local, migrations, OAuth et tests.
- [.env.example](../.env.example) — noms des variables et interrupteurs ; aucune valeur réelle.
- [Brief initial](../SPEC-gamenight.md) — intention de départ, document historique qui ne décrit pas tout l’état actuel.

## Guides de fonctions

- [Sondages de disponibilités](SONDAGES_DISPONIBILITES.md) — organisation par sondage.
- [Jeux communs des participants](JEUX_COMMUNS_PARTICIPANTS.md) et [préférences de suggestions](PREFERENCES_SUGGESTIONS_JEUX.md).
- [Annulation des séries](ANNULATION_SERIES.md) et [places de session](SESSION_PLACES.md).
- [Abonnements calendrier](ABONNEMENT_CALENDRIER.md) — flux iCal privé.
- [Réponses Discord aux soirées](DISCORD_REPONSES_SOIREES.md).
- [Défis Discord The Tower](tower-challenges.md) — lot préparé en brouillon, activation et enregistrement des commandes séparés.
- [Audit local du serveur Discord](AUDIT_DISCORD.md) — inventaire REST en lecture seule, sans membres ni messages.
- [Checklist de préparation](L3-06-preparation-checklist.md) et [galerie vidéo](CLIPS_VIDEO.md).
- [Architecture The Tower 2.0](TOWER_2_ARCHITECTURE.md) — état vérifié, cible prudente, migration et retour arrière; l’inventaire détaillé reste privé.
- [Revue des rôles The Tower](TOWER_ROLE_REVIEW.md) — constats sans publier les détails de permissions.
- [Lacunes progression](TOWER_PROGRESSION_GAPS.md), [GameNight et équipes](TOWER_COMMUNITY_GAPS.md) et [fidélisation](TOWER_RETENTION_GAPS.md) — fonctions présentes et prochains incréments.

## Exploitation et sécurité

- [Routes cron et backfill](CRONS.md) — routes, méthodes et garde d’authentification ; les cadences sont hors dépôt.
- [Réconciliation sécurité du travail de Claude](SECURITE_CLAUDE.md) — constats, preuves, correctifs et limites restant à vérifier.
- [Déploiement multi-communautés](COMMUNITY_ROLLOUT.md) — ordre de configuration et limites opérationnelles.
- [Feuille de route GameNight et The Tower 2.0](ROADMAP.md) — suivi vivant et découpage en PR.

## Recettes et documents de référence

- [Cahier des charges canonique — The Tower 2.0 × GameNight](CAHIER_DES_CHARGES.md) — texte de référence fourni par Maxime, conservé mot pour mot.
- [Édition de navigation et décisions d'exploitation](TOWER_CAHIER_DES_CHARGES_GLOBAL.md) — complément enrichi ; en cas de divergence initiale, le cahier canonique prévaut.

- [Recette finale](RECETTE_FINALE.md) — photographie datée des parcours et validations locales ; ne vaut pas validation de configuration distante.
- [Recette locale authentifiée](RECETTE_LOCALE_AUTHENTIFIEE.md) — protocole et preuves d’une session locale datée.
- [Stabilisation V2](STABILISATION_V2.md) — relevé technique historique.
- [Domaines de communauté — PR A](COMMUNITY_DOMAINES_PR_A.md) et [PR B](COMMUNITY_DOMAINES_PR_B.md) — dossiers techniques conservés.
- [Mesures de charge communauté](COMMUNITY_LOAD_RESULTS.json) — données de mesure conservées.
- [Mission du 19 octobre](MISSION-20261019.md) — photographie de suivi datée, pas un point de reprise actif.

## Archives

Les anciens journaux et états de reprise sont dans [l’archive documentaire](archive/README.md). Ils préservent leur contexte historique ; pour l’état de reprise courant, utiliser uniquement [docs/REPRISE_AUTONOME.md](REPRISE_AUTONOME.md).

## Audit transversal proposé — novembre 2026 (branche documentaire non fusionnée)

- [Verdict d'audit, sécurité et blocages opérationnels](TOWER_AUDIT_CONCLUSIONS_20261110.md) — ce qui est effectivement prouvé et ce qui manque encore avant certification.
- [Cahier des charges évolutif proposé](TOWER_AUDIT_CDC_PROPOSITION_20261110.md) — accueil guidé, recherche par jeu, équipes persistantes et vocaux privés temporaires ; **non approuvé pour implémentation**.
- [Matrice de conformité par section](TOWER_AUDIT_CODE_CIBLE_20261110.md) — inventaire du dépôt, 26 sections du cahier et état des PR.
- [Grille des 17 critères de livraison](TOWER_RECETTE_17_CRITERES_AUDIT_20261110.md) — contrôles code/configuration/recette requis.
- [Preuves CI, Vercel/Neon et documentation Discord](TOWER_PREUVES_CI_RECHERCHE_20261110.md) — résultats horodatés et limites explicites.

Ces documents ne remplacent pas [le cahier canonique](CAHIER_DES_CHARGES.md) ni [les décisions validées](TOWER_DECISIONS_26_20261104.md). La coordination reste dans [#400](https://github.com/ZeyFro/gamenight/issues/400) et la relecture documentaire dans [#432](https://github.com/ZeyFro/gamenight/issues/432).

- [Audit sécurité et montée en charge (revue ciblée du 10/11)](TOWER_AUDIT_SECURITE_SCALE_20261110.md) — preuves dans le code : limiteur de requêtes uniquement en mémoire, webhook Discord sans contrôle d'âge du timestamp, listing des équipes non paginé ; recommandations et tests de non-régression.

- [Exécution indépendante du checkout main en Vercel Sandbox](TOWER_AUDIT_EXECUTION_REELLE_20261110.md) — npm ci, TS, lint, build, tests PostgreSQL locaux, audit npm et contrôles HTTP publics réels. Ce rapport **remplace les mentions historiques « clone impossible »**.
