# Semaine 1 — du lundi 30 novembre au dimanche 6 décembre 2026

> **Brouillon à relire par Maxime.** Plan de pilotage de la première semaine, par vagues d'invités. Il **n'active rien** : chaque geste réel (variable Vercel, redéploiement, SQL, message Discord) reste fait par Maxime, ou sous son accord explicite. Les effectifs, noms et créneaux marqués **À COMPLÉTER** ne sont pas dans le dépôt et ne sont pas inventés.
>
> Complète [SOIREE_ACTIVATION.md](SOIREE_ACTIVATION.md) (la soirée d'activation), [PHASE_TEST.md](PHASE_TEST.md) (les groupes d'activation) et [GUIDE_MODERATION.md](GUIDE_MODERATION.md). Procédures de crise : [RUNBOOK.md](RUNBOOK.md). Checklist avant ouverture : [CHECKLIST_LANCEMENT.md](CHECKLIST_LANCEMENT.md). Textes à publier : [MESSAGES_LANCEMENT.md](MESSAGES_LANCEMENT.md).

## 0. Faits de départ

- Lancement : **semaine du 1er décembre 2026**. Saison 1 : **1er décembre 2026 au 31 mars 2027** (le 1er décembre à 00:00 Paris, fin exclue au 1er avril ; `src/lib/tower-challenge-seasons.ts`). Le **30 novembre est encore dans la saison S3 · 2026** : un défi réussi ce jour-là ne compte pas pour la S1. **À décider par Maxime** : pas de défi attribué aux invités avant le 1er décembre, ou assumé.
- Connexion **fermée** : seuls les membres du serveur Discord The Tower peuvent se connecter (S0). Conséquence pratique : **une « vague » n'est pas un contrôle d'accès technique**, c'est une question de **qui est prévenu et où**. Ne rien poster dans un salon visible de tous avant la vague d'ouverture.
- `/api/health` n'est **pas public** : il exige `Authorization: Bearer <CRON_SECRET>` ; il teste seulement la base (`SELECT 1`), ni Discord, ni l'executor. Ne jamais coller le secret dans un service qui l'affiche ou le journalise (voir « Vérifications en lecture seule » dans `docs/VERIFS_LECTURE_SEULE.md` de la branche `claude/docs-verifs`).
- Les journaux d'exécution Vercel (plan Hobby) ne remontent qu'à **1 h** : une erreur de la veille n'est plus visible. D'où des **relevés à heures fixes** (section 3).
- Chaque fusion dans `main` **redéploie la Production**, même pour de la documentation : **gel des fusions** pendant la semaine, sauf correctif décidé par Maxime.
- Défi d'équipe quotidien (`TOWER_TEAM_DAILY_ENABLED`) : **OFF par défaut, à décider par Maxime** (voir [SOIREE_ACTIVATION.md § 5](SOIREE_ACTIVATION.md)). S'il est activé, il s'attribue autour de 18:00 Europe/Paris (17:00 UTC le 1er décembre ; les workflows planifiés GitHub peuvent avoir quelques minutes de retard).

## 1. Qui fait quoi

| Rôle | Qui | Fait | Ne fait jamais |
| --- | --- | --- | --- |
| **Pilote** | Maxime | Variables Vercel, redéploiements, retours arrière, décisions go/no-go, messages `@everyone` | Coller un secret dans un chat |
| **Veille** | À COMPLÉTER par Maxime (nom, créneaux) | Relevés quotidiens (section 3), alerte au pilote | Modifier Vercel, Neon ou Discord |
| **Modération** | À COMPLÉTER par Maxime | Salon des retours, signalements, journal ([GUIDE_MODERATION.md](GUIDE_MODERATION.md)) | Sanctionner sans journal |
| **Testeur** | ChatGPT (compte membre de test, sans accès Vercel ni Neon ni secret) | Tape les commandes dans Discord, rapporte ce qu'il voit | Recevoir le jeton du bot ou `CRON_SECRET` |
| **Documentation** | Claude | Écrit et relit les documents | Active ou écrit quoi que ce soit en production |

## 2. Calendrier jour par jour (proposition, **à valider**)

| Jour | Vague | Objectif | Actions | Sortie attendue |
| --- | --- | --- | --- | --- |
| **Lun. 30 nov. (J-1)** | **Vague 0** : équipe et testeurs (effectif : **À COMPLÉTER**) | Tout est prêt, rien d'ouvert à tous | Relire [CHECKLIST_LANCEMENT.md](CHECKLIST_LANCEMENT.md) ; dernier run « Migrations Production » vert ; `/api/health` = 200 ; `/aide` avant/après ; test minimal ([SOIREE_ACTIVATION.md § 7](SOIREE_ACTIVATION.md)) avec un compte non modérateur | Checklist verte ; décision du pilote : on ouvre demain ou non |
| **Mar. 1er déc.** | **Vague 1** : premiers invités (effectif : **À COMPLÉTER**), message dans un salon restreint ou MP | Premier vrai usage, début de la S1 | Invitations vague 1 ; premier relevé 1 h après ; relevé du soir ; si activé, première attribution d'équipe vers 18:00 Paris | Aucun critère d'arrêt déclenché ; retours lus |
| **Mer. 2 déc.** | Vague 1 (suite) | Observer 24 h réelles | Relevés ; suivre un défi de bout en bout (défi, preuve, vote 24 h, résultat) ; premières décisions de modération | **Point de contrôle vague 2** (section 5) |
| **Jeu. 3 déc.** | **Vague 2** : élargissement (effectif : **À COMPLÉTER**) | Monter en charge, tester les votes et le quorum | Invitations vague 2 ; relevés renforcés dans les 2 h qui suivent | Quorum atteint sur au moins un vote ; file d'executor vide |
| **Ven. 4 déc.** | Vague 2 (suite) | Observer, corriger sans fusionner | Relevés ; tri des retours ; message de point d'étape si utile | **Point de contrôle ouverture générale** |
| **Sam. 5 déc.** | **Vague 3 : ouverture générale** (proposition, **à décider**) | Annonce à tout le serveur | Annonce `@everyone` **seulement** si le point de contrôle est vert ([MESSAGES_LANCEMENT.md](MESSAGES_LANCEMENT.md) (a)) ; relevés toutes les 2 à 3 h en journée | Pas de pic d'erreurs, pas de spam |
| **Dim. 6 déc.** | Observation | Bilan de la semaine | Dernier relevé ; revue du journal de modération ; **décision go/no-go** (section 6) | Décision écrite |

Les jours et vagues ci-dessus sont une **proposition** : seul le lancement « semaine du 1er décembre » est décidé. Si l'ouverture générale doit rester dans la semaine suivante, décaler la vague 3 sans toucher au reste.

## 3. Points de contrôle quotidiens

Heures proposées (**à valider**, à ajuster aux disponibilités) : **matin, midi, soir**, et **1 h après chaque vague** (la fenêtre de 1 h des journaux Vercel oblige à regarder souvent).

| # | Contrôle | Où | Attendu | Si rouge |
| --- | --- | --- | --- | --- |
| 1 | **Journaux Vercel, dernière heure** | Projet Vercel → Logs, Environment = Production, Level = Error | Aucune erreur 5xx nouvelle | Noter l'heure, la route ; refaire le relevé après redéploiement (section 4) |
| 2 | **Santé de la base** | `GET /api/health` avec l'en-tête `Authorization: Bearer …` depuis un outil qui ne journalise pas le secret | `200 {"ok":true,"db":"ok"}` ; un `503` = base injoignable | Critère d'arrêt si confirmé |
| 3 | **Run « Migrations Production »** | GitHub → Actions → workflow « Migrations Production » | Dernier run vert (aucune migration en attente) | Critère d'arrêt (migration rouge) |
| 4 | **Notifications Discord** | Salons d'annonce et de preuves ; MP des comptes de test | Un seul message par événement, édité et non dupliqué ; **aucun `@everyone`/`@here`** hors annonce prévue ; le créateur d'une soirée n'est jamais mentionné dans le fil | Critère d'arrêt (spam) |
| 5 | **File d'executor** | Vercel Logs, chemin `/api/cron/notification-executor` : réponses 200/202 récentes ; `/admin/tableau-de-bord` (si `ADMIN_DASHBOARD_V2_ENABLED`) : opérations Discord en échec | 0 opération en échec, pas de file qui s'accumule | Ne pas relancer en boucle ; voir [RUNBOOK.md](RUNBOOK.md) |
| 6 | **Crons externes** | Console du service de cron externe (cron-job.org ou équivalent) : actifs, sans échec ; cadences réelles non vérifiables depuis le dépôt | Passages réguliers | Prévenir le pilote |
| 7 | **Isolation des données** | Un compte non membre ou d'un autre serveur ne voit rien de The Tower | Aucune donnée visible | Critère d'arrêt immédiat (fuite) |
| 8 | **Retours** | Salon des retours (À COMPLÉTER), signalements `/Signaler` si actif | Lus, classés, réponse sous 24 h | Voir [GUIDE_MODERATION.md](GUIDE_MODERATION.md) |

Chaque relevé laisse une ligne (heure, relevé par, résultat) dans un fichier privé : **À COMPLÉTER** (lieu).

## 4. Critères d'arrêt et de retour arrière

### Arrêt immédiat du palier en cours (on ne passe pas à la vague suivante, on gèle)

- **Un seul 5xx confirmé après redéploiement** : une erreur serveur qui se reproduit après un redéploiement du même commit (une erreur isolée non reproduite est notée, pas confirmée).
- **Fuite de données** : un compte voit des données d'une autre communauté ou d'un autre membre.
- **Spam Discord** : messages dupliqués, mentions inattendues (`@everyone`, `@here`), rafale de MP, annonces publiées sans que l'événement ait eu lieu.
- **Migration rouge** : le run « Migrations Production » échoue, ou le code déployé attend une migration non appliquée.
- Complément proposé : `/api/health` en `503` après nouvel essai ; executor en échec persistant (opérations Discord `FAILED` qui augmentent).

### Réaction

1. **Geler** : pas de nouvelle invitation, pas d'annonce, pas de fusion dans `main`.
2. **Choisir le levier le moins large**, du plus rapide au plus lent. Procédure complète et ordre exact : [RUNBOOK.md](RUNBOOK.md). Leviers déjà documentés : couper la Tour pour la communauté sans redéployer (`towerChallengesEnabled`, [ACTIVATION_TOUR.md](ACTIVATION_TOUR.md) et [SOIREE_ACTIVATION.md § 2.4](SOIREE_ACTIVATION.md)), retirer un interrupteur puis redéployer, retour au déploiement précédent ([SOIREE_ACTIVATION.md § 6](SOIREE_ACTIVATION.md) ; attention : après un retour arrière Vercel, les prochaines fusions ne se mettent plus en ligne tant qu'un déploiement n'est pas re-promu).
3. **Publier** le message de panne ou de fin d'incident ([MESSAGES_LANCEMENT.md](MESSAGES_LANCEMENT.md) (e)) ; jamais de `@everyone` pour un incident.
4. **Noter** l'incident (heure, cause, action, décision) au journal.
5. Les messages, rôles, salons et fils déjà créés sur Discord ne sont **jamais** supprimés par le code : le nettoyage est manuel, par le pilote, sur identifiant exact.

## 5. Critères pour passer à la vague suivante

Tous vrais pendant au moins **24 h** (ou, pour la vague 1, depuis l'ouverture) :

- [ ] Aucun critère d'arrêt déclenché ; zéro 5xx confirmé.
- [ ] Run « Migrations Production » vert ; `/api/health` = 200 à chaque relevé.
- [ ] Notifications Discord : un message par événement, aucun spam ; file d'executor sans échec persistant.
- [ ] Au moins un parcours complet observé (défi attribué, preuve, vote, résultat) sans anomalie.
- [ ] Retours de la vague lus et classés ; aucun blocage ouvert sans réponse.
- [ ] Modération prête : journal tenu, personnes de service connues.
- [ ] Vague 3 seulement : [MESSAGES_LANCEMENT.md](MESSAGES_LANCEMENT.md) relu, lignes non actives retirées, et pages légales décidées ([SOIREE_ACTIVATION.md § 9 bis](SOIREE_ACTIVATION.md)).

## 6. Décision go/no-go du dimanche 6 décembre

| Question | Réponse | Preuve |
| --- | --- | --- |
| Aucun critère d'arrêt n'a été déclenché, ou chacun a été résolu et expliqué ? | oui / non | Journal des incidents |
| Les relevés de la semaine sont-ils complets (matin, midi, soir) ? | oui / non | Fichier des relevés |
| Retours bloquants restants ? | liste | Salon des retours |
| Modération : charge tenable, journal à jour ? | oui / non | [GUIDE_MODERATION.md](GUIDE_MODERATION.md) §9 |
| Interrupteurs facultatifs à allumer ou laisser éteints (défi d'équipe quotidien, validation Steam, votes par boutons, etc.) ? | liste, **décision de Maxime** | [PHASE_TEST.md](PHASE_TEST.md) |

Décisions possibles :

- **GO** : régime normal ; on garde le gel des fusions jusqu'au jour fixé par Maxime : **À COMPLÉTER**.
- **GO avec réserves** : on garde tout en place, on liste les corrections, on ne passe pas à de nouvelles activations.
- **NO-GO** : retour arrière du palier en cause selon [RUNBOOK.md](RUNBOOK.md), message de fin d'incident, nouvelle date : **à décider par Maxime** (aucune date n'est annoncée d'avance).

Décision prise par : Maxime. Date et heure : _______.
