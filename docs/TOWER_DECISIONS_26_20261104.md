# The Tower 2.0 — décisions §26 et écarts constatés (04/11/2026)

> **Décisions validées par le propriétaire. Document d'alignement, aucune règle du serveur ni code déployé par cette PR.** Toute mise en service nécessite un audit puis accord spécifique. Ne pas modifier une autre branche pendant sa relecture par Claude.

## Décisions finales / provisoires

| Domaine | Décision |
| --- | --- |
| Récompense des défis | **+1 facile, +2 moyen, +3 difficile**, confirmée avant activation |
| Rang Ranker | Étage personnel 30 |
| Rang High Ranker | Étage personnel 100 **et au moins une saison terminée** |
| Couleurs | Régulars gris ; Irregular bleu ; Ranker violet `#8b5cf6` ; High Ranker or |
| Équipes | 2 à 8 membres ; **une seule équipe active par joueur** ; 7 jours de délai après départ avant adhésion à une autre équipe ; transfert du capitaine inactif depuis 30 jours au membre actif le plus ancien |
| Défi équipe | Quotidien à **09:00 Europe/Paris** ; vérifier le réveil de Neon et l'ordonnanceur externe, car le compute peut dormir de 03:00 à 08:00 |
| Saison 1 | Du **lundi 4 janvier 2027 00:00** au **dimanche 28 mars 2027 23:59:59**, Europe/Paris, fin exclusive le 29 mars 00:00 |
| Saisons suivantes | S2 avril–juin ; période d'été juillet–août ; S4 septembre–décembre. **1–3 janvier et 29–31 mars : intersaisons sans score à traiter explicitement** |
| Classement | Étages gagnés dans la saison, puis nombre de défis difficiles, puis premier joueur arrivé au total final |
| Récompenses | Top 3 : titre cosmétique, badge, Hall of Fame ; top 1 : droit de proposer un défi pour la saison suivante, soumis aux règles du serveur |
| Accueil | Conserver YAGPDB et le panneau à 3 boutons (§4.2). Pas d'onboarding natif Discord |
| Ouverture | Bêta interne mi-décembre 2026 ; ouverture publique prévue le **4 janvier 2027** |
| Hors lancement | Pas d'IA concierge ni de Discord Activities au lancement |
| Identité / équité | **Exclusion des comptes de test abandonnée** : Maxime continue de tester avec son propre compte Discord. Aucun identifiant de test ni filtre spécial de vote ne sera configuré. Les contrôles d'accès et d'équité habituels restent applicables |
| Preuves sans quorum | Après 24 h : restent en attente sans re-vote. Signalement staff après 7 jours ; archivage après 30 jours sans décision, sans récompense et sans effacement des preuves |
| Contestation | Option 7B : joueur auteur, motif/élément nouveau, une seule décision motivée par le modérateur, historique auditable. Délai : 24 heures après l'annonce du résultat du vote, décision consignée dans l'issue #400 et docs/ROADMAP.md; le cahier canonique reste inchangé |
| Conflit d'intérêts | Si la preuve contestée appartient au modérateur Maxime / zeyfro, il se récuse. **Arbitre indépendant désigné parmi ses collègues**, sans pouvoir d'attribution de rôles/administration du serveur ; décision conservée avec auteur et motif. Si l'arbitre est impliqué ou absent, attente sans auto-validation ni récompense. |

## Conflits de code et écarts à traiter avant lancement

| Criticité | Preuve (sur main à date) | Écart |
| --- | --- | --- |
| Bloquant | `src/lib/tower-challenge-seasons.ts:33-55`, `src/lib/tower-challenge-seasons.test.ts:5-22` | Saisons actuelles : septembre–décembre, **1er janvier–31 mars**, avril–juin, juillet–août inactif. Nouvelle saison 1 commence **4 janvier**, finit **28 mars** ; été doit être défini comme saison ou intersaison dans le code |
| Bloquant | `src/lib/tower-challenges.ts:693-714` | Top 10 trié par étages puis **userId** : manque nombre de défis difficiles puis premier arrivé |
| Bloquant | `src/lib/community-teams-rules.ts:3-9` et `src/app/equipes/page.tsx:56` | Equipes autorisées **2–20** membres, décision **2–8** |
| Bloquant | `src/lib/community-teams.ts:127-186` | Création max 3/24 h et adhésions multiples possibles ; aucune règle démontrée **une équipe par joueur / délai 7 jours après départ** ; le capitaine ne peut actuellement pas quitter sa propre équipe |
| Important | `src/lib/community-teams.ts:190-210` | Un membre ancien peut seulement gérer le recrutement si le capitaine n'est plus membre actif. **Aucune passation automatique après 30 jours d'inactivité** |
| Important | `src/lib/tower-challenges.ts:109-149` | Le défi d'équipe du jour est attribué au **premier accès** si absent, pas garanti à 09:00 par cette fonction ; il faut contrôler le cron protégé et sa cadence externe |
| Important | `src/lib/tower-challenge-voting.ts:23-42` | Déduplication des votes par `voterId`, pas par personne physique. C'est cohérent avec la décision d'abandonner l'exclusion des comptes de test; Maxime teste avec son propre compte Discord |
| Important | `src/lib/tower-challenges.ts:670-766` | Classement / vote de saison existent, mais pas de preuve d'automatisation des titres, badges, Hall of Fame, de la proposition du top 1 ni des critères Ranker / High Ranker |
| Important | `src/lib/tower-challenge-starter-catalogue.ts` et `src/lib/tower-team-challenge-starter-catalogue.ts` | Le barème +1/+2/+3 est représenté par `rewardFloors` ; le catalogue de 30 défis est en PR brouillon #367 **non importé** |
| Bloquant | Permissions Discord et Atlas | Pas de preuve d'arrêt des attributions d'étages d'Atlas ni de suppression sécurisée des doublons. Aucun retrait de rôle automatique |
| Important | Parcours contestation | Décision prise, **implémentation non prouvée** ; éviter qu'une contestation réattribue deux fois ou contourne le plafond quotidien |
| Important | Environnement Preview | `preview-gamenight` contient **58 tables, 72 migrations**, mais production **96 tables, 118 migrations**. La première est vide (User/Community/Membership=0) ; mettre son **schéma** à jour sans importer les données production |

## Séparation des tâches

- **ChatGPT** : code, tests, PR brouillon, préparation des commandes et variables ; actions de production ou de Discord uniquement après accord explicite, sans secrets en clair.
- **Claude** : revue indépendante des PR sans modification concurrente, contre-vérification de GitHub/Vercel/Neon, rédaction des règles publiques, go/no-go avant activation.
- **Propriétaire** : accès Discord/OAuth, choix de l'arbitre, revue des preuves, essais humains et autorisations explicites.

## Jalons et conditions de validation

- **Novembre** : environnement de recette isolé ; correctifs entrée/OAuth, équipes, calendrier, double source Atlas, votes distincts et backend contestations.
- **Début décembre** : règles publiques relues, bots et permissions configurés en recette, migration restauration snapshot vérifiée, catalogues importés seulement en recette.
- **Mi-décembre** : bêta interne avec de vrais utilisateurs, avec les comptes personnels des testeurs; aucun compte de test exclu par configuration ; suivi des anomalies.
- **Fin décembre** : corrections, go/no-go indépendant de Claude et tests de déploiement/restauration.
- **4 janvier 2027** : ouverture publique **seulement si critères et preuves complets** ; sinon report daté, pas d'activation partielle présentée comme livrée.

**Interdictions :** aucune fusion, aucun flag, variable Vercel, migration production, enregistrement de commandes Discord ou suppression de rôle/message sans accord. La présente PR ne modifie que cette documentation.
