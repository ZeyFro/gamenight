# The Tower 2.0 — grille de réception des 17 exigences

**Édition 10 novembre 2026**, alignée sur §25 du [cahier canonique](CAHIER_DES_CHARGES.md) et [audit statique](TOWER_AUDIT_CODE_CIBLE_20261110.md). Cette grille est un **plan de preuve** ; **aucune ligne n'atteste une livraison Production**.

| # | Critère officiel abrégé | Source code / état documenté | Preuve manquante avant « validé » |
|---|---|---|---|
| 1 | Identité visuelle et navigation | Structure planifiée dans `TOWER_2_ARCHITECTURE.md` | Test UX ordinateur + téléphone, capture d'un nouveau membre |
| 2 | Accueil nouveau membre réel | Panneau 3 boutons `tower-onboarding-panel.ts` ; fonction de publication non câblée | Accès YAGPDB/Régulars, clics et destination, compte non-admin |
| 3 | Tickets/rôles/modération historiques | Plan de conservation YAGPDB, Ticket Tool, Atlas, Appy | Essai des panneaux et vérification des permissions |
| 4 | Grades/permissions cohérents | `tower-ranks.ts`, règles et architecture | Vérifier Ranker/HighRanker sans privilèges admin, contrôle réel |
| 5 | Ascension sans double progression | `tower-challenges.ts` ; historique Atlas inchangé | Source unique vérifiée et bascule autorisée |
| 6 | 134 rôles Etage retirés avec contrôle | Script audit disponible ; retrait non prouvé | Inventaire des attributions réelles, autorisation et plan de retour |
| 7 | Défis solo et équipe | `tower-challenges.ts`, catalogues, #396 Draft | 12h/48h/quotas, cron et essais utilisateurs réels |
| 8 | Preuves/votes/contestations | `discord-tower-challenges.ts`, #407 Draft | Dépôt, quorum, délai 24h, arbitrage, vraie annonce |
| 9 | Quotas et anti-abus | Règles de défis et tests existants | Scénarios concurrents Postgres et replays Discord |
| 10 | Équipes et forums | `community-teams.ts` + forums rapportés ; #370, #408, #416 Draft | 2–8/équipe unique, tri Minecraft, publication/recrutement réels |
| 11 | Soirées/événements intégrés | Sessions, tournois, calendrier dans ROADMAP | Discord ↔ GameNight et notifications observées |
| 12 | Classements/saisons/récompenses | Moteurs Tower / podium ; #325 Draft | Saison finie, classement stable, cadeaux attribués une fois |
| 13 | Catalogue/calendrier saison 1 | `TOWER_SAISON1_CATALOGUE_30.md`, décisions saison du 04/11 | Catalogue approuvé/importé et planning publié |
| 14 | Données et permissions protégées | Isolation communautaire et CI | Tests accès croisés, rôles Discord et secrets inspectés en sécurité |
| 15 | Déploiements vérifiés sur Discord | CI GitHub et Vercel documentés | Commandes réellement visibles, flags exacts, interaction réelle |
| 16 | Facultatif non développé identifié | IA concierge, Activities hors lancement | Journal des options OFF et restrictions claires |
| 17 | Aucun faux avancement | ROADMAP et #400 distinguent code/flag/recette | Bilan final avec preuves datées ; ne pas assimiler « Draft/CI » à « fait » |

## Modalités de mesure

Chaque critère passe par les états `INCONNU → SOURCE TROUVÉE → TESTS AUTOMATISÉS SUR SHA → CONFIGURATION VÉRIFIÉE → RECETTE RÉELLE → APPROUVÉ`. Un état peut être **BLOQUÉ** si migration, permission, autorisation Discord ou conflit de PR. À toute étape joindre :

- SHA Git et numéro PR (ou `main`), environnement exact et date UTC.
- Test ou manipulation reproductible, résultat attendu et observé.
- Indication explicite des données de test ou d'un utilisateur réel volontaire.
- Validation d'accès privé, protection des autres communautés et absence de doubles effets.
- Décision écrite avant modification de Production, suppression de rôle ou activation Discord.

**Statut global à cette date : NON VALIDÉ POUR LANCEMENT.** Motif : au minimum, preuves de parcours nouveau membre, migration progressive, enregistrement de commandes, activation de flags et recettage Discord réel manquants. La date cible 4 janvier 2027 du document de décisions est une **prévision sous conditions**, pas un accord pour lancer.

## Nouveaux critères à cadrer après validation du propriétaire

A. Un joueur intéressé par Minecraft accède aux recherches, recrutements et projets/aventures filtrés par jeu, sans multiplication des salons/rôles ; navigation claire sur mobile.

B. Une équipe persistante dans GameNight peut utiliser un vocal Discord privé et temporaire ; doublons, invités, permissions, suppressions et redémarrages bot sont testés.

C. Les utilisateurs voient surtout les activités pertinentes, les modérateurs voient les outils et signalements, sans accès superflu aux espaces privés.

D. Simulations documentées à 500, 2 000 et 10 000 membres (inscrits ≠ simultanément actifs) et seuils d'alerte/API Discord.

**Les critères A–D sont des propositions non approuvées ; ils ne conditionnent pas rétroactivement les 17 critères historiques sans arbitrage.**
