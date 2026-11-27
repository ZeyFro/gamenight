# Recette réelle par parcours — 6 parcours pour les 61 lignes actives

Relevé du 27/11/2026. Ce document **regroupe** les 61 lignes actives de [CAHIER_FINAL.md](CAHIER_FINAL.md) en **6 parcours de test réel**, pour faire moins de tests tout en couvrant les mêmes lignes. Le détail ligne par ligne (prérequis, étapes, preuves attendues) reste dans [RECETTE_61_LIGNES.md](RECETTE_61_LIGNES.md).

**Règle de preuve amendée le 27/11/2026** : **ZeyFro ou Melah** sont acceptés ; l’**accès, la visibilité, la confidentialité et l’arrivée** se vérifient avec **Melah** ; pour les lignes à **3 comptes ou plus**, un **scénario automatisé multi-utilisateurs** daté et consigné est accepté, les **éléments Discord** restant vérifiés en réel. Ce document ne change aucun statut. Les parcours des lignes déjà vertes (**C021, C030, C031, C077, C084**) restent des contrôles de non-régression facultatifs.

## Comptes et règles communes

**Comptes**
- **M** : Melah, membre de The Tower (MEMBER, non booster).
- **M2** : second compte accepté, **ZeyFro ou Melah**. Pour une ligne à **3 comptes ou plus**, le scénario automatisé multi-utilisateurs remplace M2.
- **N** : compte Discord **neuf**, jamais entré sur le serveur (parcours P1).
- **A** : `!!ZeyFro`, admin. Il prépare, arbitre ou observe, et peut prouver les lignes que la règle du 27/11 accepte.

**Règles**
- Les flags du relevé Production du 27/11 sont **déjà allumés** ([ALLUMAGES.md](ALLUMAGES.md)). Aucun autre flag ne s'allume sans l'accord de Maxime, lot par lot.
- **Données de test** : créées pendant le parcours par M ou M2, puis supprimées ou laissées selon la décision de Maxime. Jamais de données inventées en base.
- **Arrêt immédiat** : appliquer [PLAN_TESTS.md § 10](PLAN_TESTS.md).

**Champs de preuve, à recopier pour chaque ligne testée**

| Date (heure de Paris) | Compte | Ligne | Étape | Capture ou lien | Résultat (OK / écart) |
| --- | --- | --- | --- | --- | --- |

Le résultat est ensuite reporté dans la colonne « Preuve attendue » du cahier. Seul Maxime change le statut.

## Testable quand ?

- **Maintenant** : le code est dans `main` et le flag est déjà allumé en Production.
- **Après PR** : il faut d'abord fusionner la PR citée. Une migration éventuelle demande l'accord de Maxime.
- **Après allumage** : le code est dans `main`, mais il faut allumer le lot d'[ALLUMAGES.md](ALLUMAGES.md).
- **Maxime seul** : action dans Discord ou dans une console avec ses droits de propriétaire.

---

## P1 — Arrivée et `/role` (compte neuf N, puis M)

**Prérequis** : compte N ; panneau d'accueil #635 **publié avec l'accord de Maxime** (D11) ; écran de première connexion #640.

**Étapes**
1. N rejoint le serveur, lit le règlement, valide avec YAGPDB. Le rôle Régulars est attribué.
2. N clique les 3 boutons du panneau d'accueil. Les réponses sont privées et aucun rôle ne change.
3. N se connecte à GameNight. L'écran de première connexion propose jeux, `/role`, plateformes et objectif d'étage.
4. M lance `/aide`, `/profil`, `/boost` et `/tower` sans Nitro ni boost : aucun paiement n'est demandé.
5. M choisit un rôle de jeu avec `/role`, puis demande un jeu sans rôle (création par la file).
6. M renseigne son profil (jeux, plateformes, niveaux de jeu, disponibilités) et accepte le scope `connections`.
7. M achète un élément décoratif ; M2 le voit sur la fiche de M.

**Résultat attendu** : accès validé, aucune réponse publique, aucun paiement, profil complet visible par M2.

| Ligne | Testable |
| --- | --- |
| C109 Règlement et validation d'accès | Maintenant (Maxime invite N) |
| C118 YAGPDB préservé | Maintenant |
| C006 Panneau à 3 boutons | Après #640, puis publication du panneau avec l'accord de Maxime |
| C001 Sans Nitro ni boost | Maintenant |
| C059 Commandes et boutons du bot | Maintenant |
| C007 `/role` modernisé | Maintenant (flag allumé le 27/11) |
| C082 Création de rôle par la file | Maintenant (flag allumé le 27/11) |
| D01 Consentement `connections` | Maintenant (flag allumé le 27/11) |
| C086 Comptes liés, plateformes, crossplay | Maintenant (flag allumé le 27/11) |
| C040 Profil complet | Maintenant (flag allumé le 27/11) |
| C090 Personnalisation du profil | Maintenant (flag allumé le 27/11) |

## P2 — Recherche de joueurs et Potes (M, M2)

**Prérequis** : flags du lot C **allumés** (Vercel 27/11 : niveaux de jeu, matchmaking, visibilité, Potes, « Qui joue ce soir ? »). Relais forum : #639 (D3).

**Étapes**
1. M2 déclare un niveau de jeu, se dit « dispo ce soir » et publie une annonce « je cherche une partie ».
2. M filtre `/joueurs` par jeu, plateforme, niveau de jeu, horaire et micro : M2 apparaît. M ouvre `/ce-soir` et y voit M2.
3. M consulte « Partenaires compatibles » : M2 y figure.
4. M2 masque son profil : M ne le trouve plus, ni ses annonces.
5. M cherche M2 par pseudo dans Potes, envoie une demande, M2 l'accepte.
6. Seulement après #639 : l'annonce de M2 crée **un seul** post dans le forum, fermé à l'expiration ; ping de rôle sur abonnement, 3 par jour au plus.

**Résultat attendu** : filtres combinés corrects, profil masqué introuvable, demande d'ami acceptée.

| Ligne | Testable |
| --- | --- |
| C035 Critères (jeux, plateformes, niveau…) | Maintenant (flags allumés le 27/11) |
| C087 Niveau de jeu et matchmaking | Maintenant (flags allumés le 27/11) |
| C036 Langue, préférences, habitudes | Maintenant (flag allumé le 27/11) |
| C037 « Qui joue ce soir ? », « Je cherche une partie » | Maintenant ; relais forum après #639 |
| C038 Partenaires compatibles | Maintenant (flag allumé le 27/11) |
| C039 Visibilité respectée | Maintenant (flags allumés le 27/11 ; correctif #637 fusionné) |
| C128 Potes = amis | Maintenant (flag allumé le 27/11) |
| C044 Interfaces « Ce soir », roulette, calendrier, notifications | Maintenant (flags allumés le 27/11) |

## P3 — Équipe (M capitaine, M2 candidat puis recruteur)

**Prérequis** : lot E, déjà allumé (candidatures, recruteurs, critères, rivalités) ; #641 (passation journalisée) ; #642 (dissolution, D5) ; `DISCORD_TEAM_SPACES_ENABLED` allumé (Vercel 27/11).

**Étapes**
1. M crée une équipe et renseigne objectifs, critères et rendez-vous.
2. M2 trouve l'équipe, voit sa fiche complète et candidate. M accepte, puis nomme M2 recruteur.
3. Rivalité : M défie une autre équipe ; le capitaine adverse accepte ; les deux déclarent le résultat.
4. « Jouer maintenant » : M2 clique « Intéressé » puis « Rejoindre ». La session expire au bout de 2 h.
5. Avec le lot G : les salons écrit et vocal de l'équipe sont visibles de M et M2, invisibles d'un non-membre.
6. Contrôles différés : relance à 48 h ; expiration d'une candidature à 7 jours ; passation après 14 jours d'inactivité, inscrite au journal.

**Résultat attendu** : candidature acceptée, recruteur nommé, rivalité confirmée, salons réservés aux membres.

| Ligne | Testable |
| --- | --- |
| C030 Découvrir, créer, rejoindre, candidater, recruter | Maintenant ; dissolution après #642 |
| C031 Fiche d'équipe | Maintenant |
| C077 Recruteurs, invités, relance 48 h, expiration 7 jours | Maintenant ; passation journalisée après #641 |
| C084 « Jouer maintenant » et rivalités | Maintenant |
| C053 Salons vocaux d'équipe et d'événement | Maintenant (flags allumés le 27/11) ; vocaux de soirée après #646 |

## P4 — Compétition : tournoi et défis de la Tour (M, M2 ; A seulement pour arbitrer)

**Prérequis** : lot E (tournois d'équipes et scores, déjà allumés) ; #641 (poule à 5 équipes, arbitrage après 24 h, repli à 48 h, migration à appliquer avec l'accord de Maxime) ; flags du lot B **allumés** (Vercel 27/11).

**Étapes**
1. Tournoi individuel : M et M2 s'inscrivent, déclarent un résultat, puis consultent le classement et l'annonce.
2. Tournoi d'équipes : les deux capitaines confirment. Puis un désaccord est tranché par l'arbitre **après 24 h**.
3. Avec #641 et 5 équipes : poule, 10 matchs, classement, champion.
4. M demande `/tower defi`, dépose une preuve ; M2 (sur le serveur depuis 3 jours au moins) vote ✅ ou ❌ dans le fil de la preuve.
5. M signale un message (« Signaler ») : le ticket privé arrive au staff, sans sanction. M2 ne voit ni la preuve privée, ni le ticket.
6. Classements, Hall of Fame, récapitulatif de la semaine, exploits (après des données réelles).
7. Contrôles des défis désormais allumés :
   - remplacement d'un défi sur un jeu non possédé ;
   - défi d'équipe de 18 h ;
   - validation automatique par Steam ;
   - grade Irregular attribué par A ;
   - proposition de défi par un Ranker ;
   - récompenses de saison (fin de saison réelle).

**Résultat attendu** : résultats confirmés par les deux capitaines, arbitrage seulement après le délai, votes comptés, ticket privé.

| Ligne | Testable |
| --- | --- |
| C043 Tournois (inscriptions, résultats, classement) | Maintenant |
| C081 Tournois d'équipes, double confirmation | Maintenant ; poule et arbitrage 24 h / 48 h après #641 |
| C078 Votes ✅/❌, fil par preuve | Maintenant |
| C057 Confidentialité des preuves et tickets | Maintenant |
| C088 Signalement contextuel | Maintenant |
| D14 « Signaler » → ticket staff | Maintenant (même test que C088) |
| C052 Le Sommet (classements, Hall of Fame…) | Maintenant, avec des données réelles |
| C029 Animation (exploits, récapitulatifs) | Maintenant, avec des données réelles |
| C008 Grades (Irregular) | Maintenant (flag allumé le 27/11) ; preuve automatisée prête, contrôle Discord restant |
| C017 Défi d'équipe quotidien | Maintenant (flag allumé le 27/11) ; contrôle du cron réel restant |
| C020 Remplacement d'un défi | Maintenant (flag allumé le 27/11) |
| C021 Propositions de défis | ✅ Fait par preuve automatisée le 27/11 (6 comptes) |
| C079 Validation automatique Steam | Maintenant (flag allumé le 27/11) ; contrôle Steam réel restant |
| C050 Récompenses de saison | Après une fin de saison réelle (flags allumés le 27/11) ; statut inchangé |

## P5 — Soirée, projets et notifications (M créateur, M2 invité ou candidat)

**Prérequis** : `SESSION_VISIBILITY_ENABLED` (déjà allumé) ; #646 (espaces selon la visibilité, D7) ; `PROJECT_ORGANIZER_ENABLED` (déjà allumé) ; #641 (projets à 90 jours) ; `NOTIFICATION_CENTER_ENABLED` allumé (Vercel 27/11).

**Étapes**
1. M crée une soirée **publique**, une **sur candidature** et une **privée**.
2. M2 ne voit pas la soirée privée. Il candidate à la soirée sur candidature, M accepte ; à capacité atteinte, M2 passe en liste d'attente.
3. Après #646 : fil et vocal temporaires seulement pour les soirées sur candidature et privées, créés 30 min avant. Accès retirés à la fin, salons supprimés quand le vocal est vide.
4. Une action de M sur GameNight produit **un seul** message Discord, et une interaction Discord revient dans GameNight.
5. Projet : M crée un projet, M2 entre, M le valide ; vérifier le fil d'annonce public et le fil privé (D9) ; clôture, puis archivage 7 jours après.
6. Avec le lot C : préférences de notification de M2. Une soirée publique d'un seul jeu mentionne le rôle du jeu, jamais M. MP ciblé, jamais `@everyone` (D10).

**Résultat attendu** : soirée privée invisible des non-invités, espaces temporaires conformes à D7, un seul message par action.

| Ligne | Testable |
| --- | --- |
| C080 Soirées publique / candidature / privée, liste d'attente, espace temporaire | Maintenant pour la visibilité ; espaces après #646 |
| C003 GameNight → Discord sans doublon | Maintenant |
| C093 Écritures par la file | Maintenant (journal Vercel : Maxime) |
| C083 Projets (organisateur, date de fin, fils, archivage) | Maintenant ; 90 jours renouvelables après #641 |
| C076 Notifications configurables | Maintenant (flag allumé le 27/11) |
| C085 MP ciblés, pings sur abonnement, centre de notifications | Maintenant (flags allumés le 27/11) |
| D09 Pings de rôle de jeu sur abonnement | Maintenant (flags allumés le 27/11) |

## P6 — Lignes sans code et configuration Discord (Maxime, A pour observer, N et M pour vérifier)

**Prérequis** : session de Maxime sur Discord et Vercel ; aucun code à fusionner. Procédures par ligne : [RECETTE_61_LIGNES.md § A1 et A2](RECETTE_61_LIGNES.md) et [PROCEDURES_PREUVES.md](PROCEDURES_PREUVES.md).

**Étapes**
1. **Organisation et visuels** : M parcourt le serveur sur mobile et sur ordinateur. Relever les salons vides, les noms sans emoji, les panneaux, l'icône, la bannière et les annonces.
2. **Bots et rôles** :
   - liste des bots et de leurs permissions ;
   - Atlas absent ;
   - Ticket Tool (M ouvre un ticket) ;
   - Appy (M candidate) ;
   - AutoMod et anti-raid ;
   - tableau des rôles par famille ;
   - retirer à High Ranker les 3 permissions de modération vocale.
3. **Sept espaces** : vus par M.
4. **Boosters** : avec un vrai booster, rôle « Soutien de la Tour », mur, salons, retrait automatique à la fin du boost.
5. **Tableau de bord staff** (lot A) : vu par A ; M reçoit une 404.
6. **Exigences générales** : 3 pages sur mobile, aucune donnée d'une autre communauté (SELECT de contrôle en lecture seule).
7. **Développement communautaire** : liste datée des actions (soirées hebdomadaires, créateurs, partenariats).
8. **Vision** : tableau récapitulatif qui renvoie aux lignes déjà vertes de P1 à P5.

**Résultat attendu** : captures datées de chaque réglage, écarts listés.

| Ligne | Testable |
| --- | --- |
| C108 Principes d'organisation | Maintenant |
| C111 Direction artistique | Maintenant (avis de Maxime) |
| C112 Éléments visuels harmonisés | Maintenant (avis de Maxime) |
| C115 Atlas arrêté | Maxime seul |
| C120 Ticket Tool | Maintenant |
| C121 Appy | Maintenant |
| C123 Anti-raid, anti-spam, bots | Maxime seul |
| C125 Exigences générales | Maintenant |
| C127 Développement communautaire | Maxime seul |
| C104 Parcours complet du joueur | Après P1 à P5 |
| C005 Sept espaces | Maintenant |
| C011 Rôles par famille | Maxime seul |
| C056 Rôles de prestige, permissions sensibles | Maxime seul (correction de High Ranker d'abord) |
| C089 Boosters | Maxime seul (il faut un vrai booster) |
| D15 Boosters (décision) | Maxime seul (même test que C089) |
| C091 Tableau de bord staff | Maintenant (flag allumé le 27/11) ; A observe, M reçoit la 404 |

---

## Bilan de couverture

| Parcours | Lignes | Testables maintenant | Après PR | Cas particulier | Maxime seul |
| --- | ---: | ---: | --- | --- | ---: |
| P1 Arrivée et `/role` | 11 | 10 | 1 (#640, puis publication du panneau) | — | — |
| P2 Recherche et Potes | 8 | 8 | — | relais forum après #639 | — |
| P3 Équipe | 5 | 5 | — | dissolution après #642 | — |
| P4 Compétition | 14 | 13 | — | C050 après une fin de saison | — |
| P5 Soirée, projets, notifications | 7 | 7 | — | espaces après #646 | — |
| P6 Sans code et configuration Discord | 16 | 8 | — | C104 après P1 à P5 | 7 |
| **Total** | **61** | **51** | | | |

Les flags sont allumés ; les colonnes « Après PR » ne concernent plus que des évolutions de code ou la publication du panneau d'accueil.

Chaque ligne figure dans **un seul** parcours. Un même test peut toutefois alimenter plusieurs lignes : D14 = C088, D15 = C089, D01 ⊂ C086, C035 ≈ C087, C085 ≈ D09 ≈ C076.

## Ce que ce document ne prouve pas

C'est un **plan**. Aucun test réel n'a été fait ici et aucun statut n'a changé. Les flags du relevé du 27/11 sont déjà allumés. Les lignes à 3 comptes ou plus peuvent utiliser un scénario automatisé ; les autres utilisent Melah et, si besoin, ZeyFro comme second compte. La publication du panneau d'accueil reste soumise à l'accord de Maxime.
