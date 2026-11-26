# Index de la documentation

## Démarrer et développer

- [README](../README.md) — présentation, fonctions et stack.
- [Développement local](DEVELOPPEMENT_LOCAL.md) — PostgreSQL local, migrations, OAuth et tests.
- [Migrations Prisma](MIGRATIONS.md) — méthode standard : PR, CI, fusion, application automatique.
- [Activation de la Tour](ACTIVATION_TOUR.md) — les 4 interrupteurs en une soirée, plan de la soirée et retour arrière.
- [Soirée d'activation, pas-à-pas](SOIREE_ACTIVATION.md) — ordre de la soirée (Atlas, variables Vercel, redéploiement, import du catalogue, commandes du bot, test), retours arrière en une minute.
- [Phase de test avant l’annonce](PHASE_TEST.md) — six groupes d’activation du moins au plus risqué, tests Discord et application, vocal temporaire, droits minimaux du bot (retrait d’Administrateur) et valeurs à renseigner avant les pages légales.
- [Lancement : textes Discord](LANCEMENT_DISCORD.md), [conditions de réussite](CONDITIONS_REUSSITE_LANCEMENT.md) et [présentation de recrutement](PRESENTATION_RECRUTEMENT.md) — étiquetés disponible / après activation / prévue.
- [.env.example](../.env.example) — noms des variables et interrupteurs ; aucune valeur réelle.
- [Brief initial](../SPEC-gamenight.md) — intention de départ, document historique qui ne décrit pas tout l’état actuel.

## Guides de fonctions

- [Sondages de disponibilités](SONDAGES_DISPONIBILITES.md) — organisation par sondage.
- [Jeux communs des participants](JEUX_COMMUNS_PARTICIPANTS.md) et [préférences de suggestions](PREFERENCES_SUGGESTIONS_JEUX.md).
- [Annulation des séries](ANNULATION_SERIES.md) et [places de session](SESSION_PLACES.md).
- [Abonnements calendrier](ABONNEMENT_CALENDRIER.md) — flux iCal privé.
- [Suppression et export de compte](SUPPRESSION_COMPTE.md) — anonymisation, classement des relations vers `User`, export JSON, activation et limites.
- [Réponses Discord aux soirées](DISCORD_REPONSES_SOIREES.md).
- [Commandes Discord The Tower (403, invitation, enregistrement)](DISCORD_COMMANDES.md).
- [Messages à publier dans chaque salon Discord](MESSAGES_SALONS.md) — un message court par salon, avec les commandes exactes et les liens du site.
- [Procédures de preuve](PROCEDURES_PREUVES.md) — comment prouver, étape par étape et en lecture seule, les 17 éléments du cahier « non vérifiés en réel » ou « côté Discord ».
- [Défis Discord The Tower](tower-challenges.md) — lot préparé en brouillon, activation et enregistrement des commandes séparés.
- [Audit final du 23/11/2026](AUDIT_FINAL.md) — constats, corrections, restants et ce qui n'a pas pu être vérifié ; détails dans [`audit/`](audit/01-securite-owasp.md).
- [Décisions produit du 26/11/2026](DECISIONS_PRODUIT_20261126.md) — D1 à D11 (ouverture à 61 lignes vertes, /role, annonces, vocabulaire, équipes, tournois, soirées, projets, notifications, arrivée).
- [Rapport de la nuit du 24/11/2026](RAPPORT_NUIT.md) — PR fusionnées, migrations, restes, tâches ChatGPT et Maxime, décisions à valider.
- [Audit local du serveur Discord](AUDIT_DISCORD.md) — inventaire REST en lecture seule, sans membres ni messages.
- [Checklist de préparation](L3-06-preparation-checklist.md) et [galerie vidéo](CLIPS_VIDEO.md).
- [Architecture The Tower 2.0](TOWER_2_ARCHITECTURE.md) — état vérifié, cible prudente, migration et retour arrière; l’inventaire détaillé reste privé.
- [Revue des rôles The Tower](TOWER_ROLE_REVIEW.md) — constats sans publier les détails de permissions.
- [Plan serveur Discord The Tower](PLAN_SERVEUR_DISCORD.md) — zones, grades, bots, dry-run et checklist manuelle (aucune écriture).
- [Lacunes progression](TOWER_PROGRESSION_GAPS.md), [GameNight et équipes](TOWER_COMMUNITY_GAPS.md) et [fidélisation](TOWER_RETENTION_GAPS.md) — fonctions présentes et prochains incréments.

## Exploitation et sécurité

- [Capacité : 100, 500 ou 1 000 membres ?](CAPACITE.md) — limites réelles de Vercel, Neon, Discord et des tâches, seuils de casse, coûts, minimum à faire.
- [Lancement : la ligne d’arrivée (GO / NO-GO)](LANCEMENT_GO.md) — liste fermée des critères, état réel des 21 constats et des migrations.
- [Permissions des bots](PERMISSIONS_BOTS.md) — rôle et droits minimaux de chaque bot du serveur, plan pas à pas pour retirer Administrateur (Workshop, AppBot) sans rien casser.
- [Cahier final : la ligne d’arrivée](CAHIER_FINAL.md) — chaque élément du cahier, son statut réel, ce qu’il reste à faire, le responsable et la preuve.
- [Plan d’allumage par lots](ALLUMAGES.md) — lots A à J pour ChatGPT : variables exactes, vérifications, retour arrière.
- [Hébergement : rester en gratuit, surveiller, savoir partir](HEBERGEMENT.md) — limites, alerte avant saturation, migration future vers un serveur local ou OVH.
- [Notifications sur le téléphone : les 3 clés VAPID](WEB_PUSH_VAPID.md) — générer et poser les clés dans Vercel.
- [Questions pour Maxime](QUESTIONS_MAXIME.md) — les choix à faire, en une seule liste, avec recommandation.
- [Fiche de l'application](FICHE_APPLICATION.md) — pages, rôles, interrupteurs en Production, données, tâches automatiques, limites des offres gratuites, 10 risques d'ouverture.
- [Plan de tests par rôle](PLAN_TESTS.md) — parcours, résultat et preuve attendus du visiteur à l'admin, et tests à faire par un humain.
- [Contrôle de sécurité passif](CONTROLE_SECURITE.md) — en-têtes, cookies, pages refusées, routes sensibles, constats classés par gravité.
- [Runbook : retour arrière et incidents](RUNBOOK.md) — couper un interrupteur, revenir au déploiement précédent, restauration Neon, migration en échec, incident Discord, fuite de secret, contacts à compléter.
- [Checklist de lancement](CHECKLIST_LANCEMENT.md) — points à prouver avant l'annonce publique (pages légales, portail Discord, saison 1, catalogue, alertes, sauvegardes, tests de compte), avec la preuve attendue pour chacun.
- [Routes cron et backfill](CRONS.md) — routes, méthodes et garde d’authentification ; les cadences sont hors dépôt.
- [Réconciliation sécurité du travail de Claude](SECURITE_CLAUDE.md) — constats, preuves, correctifs et limites restant à vérifier.
- [Déploiement multi-communautés](COMMUNITY_ROLLOUT.md) — ordre de configuration et limites opérationnelles.
- [Feuille de route GameNight et The Tower 2.0](ROADMAP.md) — suivi vivant et découpage en PR.
- [État factuel Neon Test et pile Tower](NEON_TEST_ETAT_20261117.md) — constats du 17/11 et opérations soumises à autorisation.
- [Plan J-14 vers le 1er décembre](PLAN-J14-20261201.md) — périmètre, calendrier et chemin critique du sprint.
- [Guide de modération](GUIDE_MODERATION.md) — brouillon : rôles réels (application et Discord), échelle de sanctions, escalade, contestations Tower, contenu illégal, mineurs, journal des décisions.
- [Semaine 1 du lancement](SEMAINE_1.md) — brouillon : calendrier du 30 novembre au 6 décembre 2026, vagues d'invités, points de contrôle, critères d'arrêt et go/no-go.
- [Messages de lancement](MESSAGES_LANCEMENT.md) — brouillon : annonce, accueil, consigne Steam, correction du guide sur les étages, panne et fin d'incident.

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

- [Recette des 61 lignes actives](RECETTE_61_LIGNES.md) — prérequis, scénarios et preuves attendues.
