# The Tower 2.0 — Phase 1 : recette avant ouverture au public

> **Checklist de validation, pas une attestation de conformité.** Cahier des charges global « The Tower 2.0 × GameNight », sections 3–6, 18–19, 22–25. Audit du 4 novembre 2026, sans accès administrateur direct à Discord ni à cron-job.org.

## Situation vérifiée

- Site public Vercel : `https://gamenight-zeyfro.vercel.app` (domaine attaché au projet GameNight).
- Déploiement de `main` au commit `35ac524` : état Vercel `READY` ; **ne prouve ni l'accueil ni la connexion d'un membre**.
- La PR #361 est fusionnée ; son correctif conserve l'identité dans l'état « plusieurs communautés, choix requis ». Il faut encore vérifier AlexGG et un nouveau joueur.
- Base Neon Production, communauté The Tower liée au serveur Discord `553922938101825536` : `ACTIVE`. Membres GameNight de cette communauté : 7 `Membership.ACTIVE` au relevé du 4 novembre. Ce chiffre n'est **pas** le nombre de membres Discord.
- Les flags communautaires `communityTeamsEnabled` et `towerChallengesEnabled` sont `true`, `playerClassifiedsEnabled` est `false`. Le flag Vercel `TOWER_CHALLENGES_ENABLED` est **absent** : ne pas confondre configuration et mise en service.
- Les destinations d'annonces `SESSION` et `TOURNAMENT` sont renseignées et activées en base ; leur visibilité et leurs permissions réelles ne sont pas certifiées.
- Zéro équipe et zéro définition de défi en base au relevé. Il ne faut créer aucune activité fictive pour simuler un lancement.

## Critères d'acceptation de la phase 1

Tous les tests ci-dessous sont à effectuer **avec un vrai compte non modérateur**, pas avec l'aperçu administrateur. Aucun résultat n'est présumé positif.

| Test | Résultat attendu | Preuve minimale | État |
| --- | --- | --- | --- |
| Invitation neuve Discord | L'accès aux salons d'accueil publics fonctionne sans compte GameNight | Capture non sensible / relevé du parcours | À tester |
| Règlement et rôle Régulars | Le mécanisme YAGPDB ou autre applique le bon rôle, sans contournement | Liste des rôles avant/après, sans ID privé | À tester |
| Orientation | Trouver des joueurs, rejoindre une soirée, commencer l'Ascension sont identifiables | Capture mobile et ordinateur | À tester |
| Forums | Recherche de joueurs, recrutement et projets sont accessibles suivant les permissions | Test lecture/post d'un membre | À tester |
| Permissions privées | Aucun membre nouveau ne peut voir tickets, journaux de modération ou salons privés | Test avec compte neuf | À tester |
| Permissions bot | Lecture, messages, fils et actions autorisées uniquement dans les salons attendus | Audit des permissions Discord | À tester |
| Absence de doubles parcours | Les panneaux historiques YAGPDB, Ticket Tool et Appy n'ont pas d'équivalent concurrent | Inventaire visuel et liens des panneaux | À tester |
| Ticket Tool (#requête) | Identifier le panneau valide, sans supprimer l'autre avant validation | Capture et comparaison des deux | À traiter |
| Tournoi Casino (signalé 0/4 depuis 21 j) | Statut et ancienneté revérifiés, décision d'organisateur consignée | Capture / fiche GameNight | À traiter |
| Connexion GameNight | AlexGG puis melah3 arrivent sur le site, choisissent le serveur si demandé, sans boucle | URL finale et heure d'essai, sans cookie ni secret | À tester |
| Séparation communautés | Un utilisateur d'un autre serveur ne voit pas les données The Tower sans adhésion | Test avec deux comptes et accès distincts | À tester |

## Rôles, Atlas et sécurité publique

- **Ne pas retirer** les 134 anciens rôles d'étage avant l'inventaire des dépendances (permissions, salons et récompenses).
- Recenser qui peut actuellement donner un étage : Atlas, commandes du staff, bot GameNight, automatisations et attribution manuelle. La présence de compteurs dans GameNight ne prouve pas qu'Atlas est éteint.
- Séparer rôles de prestige (Régulars, Irregular, Ranker, High Ranker) et rôles staff (modération/administration). Une récompense ne doit jamais accorder des droits de gestion.
- Passer du mode « six amis de confiance » à un serveur public exige anti-raid, anti-spam, permissions minimales, gestion des contestations, information des membres, politique de conservation et contrôle des autres bots.
- Ne toucher ni aux permissions, ni aux rôles, ni aux messages avant accord et plan de retour arrière.

## Décision de passage à la phase 2

La phase 1 est **non validée** tant que l'arrivée d'un membre externe, les contrôles d'accès, l'accueil et les parcours Discord n'ont pas de preuves. Les tests GameNight peuvent être préparés en parallèle, mais aucun lancement public ne doit être annoncé comme terminé.

## Actions nécessitant l'accord du propriétaire

1. Toute suppression ou modification des panneaux et salons Discord.
2. Toute désactivation Atlas ou modification des 134 rôles d'étage.
3. Toute fusion de PR, activation de flag, changement Vercel ou écriture dans Neon Production.
4. Enregistrement des commandes Discord (nécessite d'abord preuve des permissions).

Les corrections de documentation et les tests non destructifs peuvent être préparés en PR brouillon séparée. Respecter l'interdiction des secrets dans les logs, captures et comptes rendus.
