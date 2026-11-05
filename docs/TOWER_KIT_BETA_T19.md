# T19 — Kit bêta The Tower 2.0

Kit de recette, pas preuve d'une bêta exécutée. Aucun message envoyé ni outil externe configuré par ce document. Les durées 24 h / 7 j / 30 j se vérifient avec des horloges et données fictives en local, jamais en avançant les dates de Production.

## Environnements et limites

- **Local** : doubles, tests unitaires et base PostgreSQL jetable isolée selon les besoins du scénario. Noter le SHA et les commandes réellement exécutées. Un scénario local ne prouve pas la configuration Production.
- **Preview Vercel** : interface de démonstration uniquement. Le code bloque les envois Discord et Web Push en Preview; aucun essai de livraison réelle n'y est attendu.
- **Essai Discord réel** : aucun serveur Discord de recette séparé. Si un essai réel est autorisé, il se déroule uniquement sur **The Tower (`553922938101825536`) avec le compte ZeyFro**, dans les limites autorisées. Aucun message, rôle, salon, commande, flag ou configuration n'est écrit sans l'accord spécifique requis.
- Ne pas simuler des votants ou comptes supplémentaires sur Discord. Les quorums, conflits d'intérêts, concurrences, fenêtres temporelles et répétitions se testent localement avec des doubles et des données fictives. Ne pas créer une configuration dédiée à l'exclusion de comptes de test.
- Aucun secret, cookie ou jeton dans la fiche, les captures ou un rapport.

## Fiche de session

Date/heure UTC : … ; organisateur : … ; URL/SHA du code : … ; appareil/navigateur : … ; environnement : local / Preview / The Tower ; compte utilisé (pseudonyme) : … ; fonctions indisponibles : … ; scénarios exécutés : … ; canal de retour autorisé : … .

Pour chaque scénario, cocher **Réussi / Échec / Non exécuté** et noter la commande ou la preuve nettoyée. Un test non exécuté n'est pas un succès. Ne noter aucune donnée d'une autre communauté.

## Scénarios

| ID | Action | Résultat attendu | Recette |
|---|---|---|---|
| B01 | Nouveau membre : règlement, rôles et accueil | Orientation claire, espaces privés invisibles, aucune inscription GameNight imposée pour discuter | The Tower, si autorisé |
| B02 | Connexion Discord, choix de communauté, équipes, accueil, déconnexion/reconnexion | Bon serveur conservé/revalidé, aucune donnée d'une autre communauté | Local + The Tower, si autorisé |
| B03 | Rechercher Minecraft puis un jeu avec accent présent dans les données fictives | Filtrage cohérent, absence de doublons, remise à zéro possible | Local |
| B04 | Créer/rejoindre une équipe fictive à 2 puis 8 membres, tenter un 9e | Bornes respectées, erreur lisible, aucune équipe partielle | Base isolée; configuration des forums/salons à vérifier séparément |
| B05 | Tenter une seconde équipe et deux adhésions simultanées | Une seule équipe active par membre et communauté | Base isolée avec concurrence |
| B06 | Départ volontaire, dissolution et simulation J+7 | Carence conforme; dissolution pénalise seulement le capitaine déclencheur | Base isolée / horloge simulée |
| B07 | Capitaine inactif : simulation 30 j puis transfert | Successeur actif le plus ancien, créateur historique conservé; dry-run sans écriture | Base isolée; accord migration requis avant toute migration réelle |
| B08 | Attribuer défi solo, retenter avant 12 h, déposer avant/après 48 h | Cooldown et expiration respectés; preuve tardive refusée selon les règles | Base isolée / horloge simulée |
| B09 | Attribuer une preuve et consulter sa fiche | Code `TWR-` + 8 caractères unique dans la communauté, visible après attribution; alternative explicite si le jeu ne permet pas de le montrer. Le code n'atteste pas à lui seul la date de la capture. | Local; essai The Tower uniquement si autorisé |
| B10 | Défi d'équipe : confirmer les participants, attribuer deux fois le même jour | Même tentative; seuls les participants éligibles bénéficient de la récompense, une seule fois | Base isolée avec traitements concurrents |
| B11 | Auteur/participant tente de voter, puis quorum et majorité | Auto-vote et vote participant refusés; scrutin de 24 h, quorum et majorité appliqués | Doubles locaux; aucun faux votant Discord |
| B12 | Égalité, quorum incomplet, vote tardif, double clic | Pas de validation sans quorum/majorité; aucune double écriture | Base isolée / horloge simulée |
| B13 | Valider plusieurs preuves solo/équipe en concurrence, près de minuit Paris | Quotas quotidiens respectés, report et idempotence conformes | Base isolée avec concurrence; jamais sur Neon |
| B14 | Contester dans/après 7 j, motif vide, conflit d'intérêts | Motif obligatoire, limite exacte appliquée; arbitre indépendant désigné et décision traçable; aucune double récompense | Base isolée / horloge simulée |
| B15 | Simuler preuve sans quorum à J+7 puis J+30 | Signalement staff unique à J+7; archivage à J+30 sans effacement ni récompense automatique | Base isolée / horloge simulée; aucun ping staff réel |
| B16 | Simuler fin de saison, intersaison, été→S4 et heure d'été/hiver | Étages permanents conservés, classement/départage corrects, scrutin existant non perdu | Base isolée / horloge simulée |
| B17 | Seuils Ranker30, HighRanker100 sans/avec saison terminée | Rang produit visible conforme, aucun pouvoir admin | Base isolée |
| B18 | Soirée/tournoi fictif : inscription, rappel, résultat, annulation | Historique conservé, notifications cohérentes et uniques; annonce collective conservée même si une préférence personnelle est coupée | Doubles locaux; essais The Tower soumis aux limites ci-dessus |
| B19 | Préférences de notification et affichage mobile/clavier | Réglages par catégorie et canal respectés; désactiver un canal ne coupe pas les autres; annonce collective sans mention non filtrée; boutons accessibles | Tests unitaires/doubles + navigateur local; aucune livraison réelle en Preview |

B14/B15 restent non exécutés tant que les lots contestation/archivage ne sont pas livrés. Ne crée pas de fausse activité Production pour compléter le tableau.

## Vérifications locales du lot notifications

Les tests suivants vérifient les résolveurs de préférence, l'action serveur, les canaux in-app/Web Push, le fallback Discord et le blocage Preview. Ils utilisent des doubles et ne contactent aucun service externe :

```powershell
npx vitest run src/lib/notification-channel-preferences.test.ts src/lib/notification-preferences.test.ts src/lib/notifications.web-push.test.ts src/lib/reward-notifications.channel.test.ts src/lib/roulette-dm.channel.test.ts src/lib/session-announce.channel.test.ts src/lib/tournament-announce.channel.test.ts src/lib/notification-executor.preview.test.ts src/app/profil/notification-channel-preference-actions.test.ts src/lib/discord.test.ts src/lib/web-push-delivery.test.ts src/app/api/cron/notification-executor/route.test.ts
```

Ce résultat local ne confirme ni les abonnements Web Push en Production, ni les permissions/configurations Discord, ni les canaux communautaires. Ces éléments restent à vérifier séparément, avec un accord explicite avant tout envoi ou changement réel.

## Formulaire de bug à copier dans le canal de retour choisi

- Identifiant : BETA-AAAA-NNN
- Scénario Bxx / titre court :
- Date et heure UTC :
- Environnement / URL sans code OAuth ni paramètre sensible / SHA :
- Appareil, navigateur, taille écran :
- Rôle du compte fictif (auteur/votant/capitaine/arbitre) :
- Étapes précises : 1… 2… 3…
- Résultat attendu :
- Résultat observé / message exact nettoyé :
- Reproductible : toujours / parfois / une seule fois
- Gravité proposée : bloquant / majeur / mineur
- Capture nettoyée : aucune adresse privée, message privé, clé, cookie ou jeton

Stop immédiat si une donnée d'une autre communauté, un secret ou un effet Production apparaît : ne pas recopier la donnée, prévenir l'organisateur par le canal convenu et suspendre ce scénario.

## Registre des retours

| ID | Scénario | Gravité | SHA observé | Statut | Responsable | PR corrective | SHA retesté | Preuve retest |
|---|---|---|---|---|---|---|---|---|
| À renseigner | | | | nouveau | | | | |

Statuts : nouveau → reproduit → correction en brouillon → CI réussie → retest humain réussi → clos. Ne pas fermer sur la seule CI. Bloquant : fuite, corruption, accès indu, récompense double; majeur : parcours essentiel impossible; mineur : présentation ou gêne contournable. Tout reclassement est motivé.

## Bilan de sortie

Comptabiliser réussis/échecs/non exécutés, bugs ouverts par gravité et parcours absents. Aucun bloquant sécurité/isolement/récompense; parcours critiques rejoués sur le SHA candidat; relecture Claude et accord du propriétaire avant activation. Ce kit ne vaut ni recrutement effectué ni bêta réussie.
