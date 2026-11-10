> ⚠️ **Correction de priorité documentaire (audit du 10/11/2026).** Les passages historiques imposant une exclusion fixe de comptes de test, un délai de contestation de 7 jours ou une guilde Discord de recette distincte sont dépassés. Décisions applicables : contestation motivée **dans les 24h après annonce effective**, arbitre indépendant fixe configuré à l'avance, **aucune exclusion particulière de compte de test** par décision du 06/11 ; serveur The Tower unique, pas de guilde sandbox à recréer. Les essais de vote réels restent soumis à de véritables membres distincts et aux protections anti-abus. Le cas B14 doit être réécrit/actualisé avant exécution. Voir [décisions](TOWER_DECISIONS_26_20261104.md), [#400](https://github.com/ZeyFro/gamenight/issues/400). Ce bandeau ne vaut pas autorisation d'utiliser Production.

# T19 — Kit bêta The Tower 2.0

Livrable préparé pour début décembre ; accès, dates exactes et testeurs à confirmer. Suivi : #400. Aucun message envoyé, aucun outil externe configuré. Première session : 30 à 60 minutes, puis scénarios différés. Les durées de 24h/7j/30j se simulent en tests locaux ou base fictive, jamais en modifiant les dates Production.

## Avant de commencer

L'organisateur fournit URL de recette vérifiée, serveur privé, version/SHA, comptes autorisés, règles publiques, canal de retour et liste des fonctionnalités effectivement disponibles. Aucun mot de passe/token/cookie ne doit être partagé. Ne pas utiliser les données Production. Les tests bot se font uniquement dans un environnement dédié autorisé : les Previews Vercel actuelles bloquent les écritures Discord et les crons.

Minimum trois vrais votants distincts, hors auteur et participants de la preuve ; prévoir davantage de personnes pour les preuves d'équipe. Aucun multi-compte pour simuler un quorum. melah3 ne vote pas en Production. L'arbitre indépendant intervient si Maxime est concerné ; aucun droit admin à donner aux testeurs.

## Fiche de session

Date/heure UTC : … ; organisateur : … ; URL de recette : … ; SHA : … ; appareil/navigateur : … ; comptes pseudonymisés : A/B/C/D… ; périmètre web ou bot : … ; fonctions indisponibles : … . L'organisateur coche Réussi/Échec/Non exécuté et conserve une preuve sans secret. Un test non exécuté n'est pas un succès.

## Scénarios

| ID | Action | Résultat attendu |
|---|---|---|
| B01 | Nouveau membre : règlement, rôles et accueil | Orientation claire, espaces privés invisibles, aucune inscription GameNight imposée pour discuter |
| B02 | Connexion Discord, choix de communauté, équipes, accueil, déconnexion/reconnexion | Bon serveur conservé/revalidé, aucune donnée d'une autre communauté |
| B03 | Rechercher Minecraft puis un jeu avec accent présent dans les données fictives | Filtrage cohérent, absence de doublons, remise à zéro de la recherche possible |
| B04 | Créer/rejoindre une équipe fictive à 2 puis 8 membres, tenter un 9e | Bornes respectées et erreur lisible, aucune équipe partielle |
| B05 | Tenter une seconde équipe et deux adhésions simultanées | Une seule équipe active par membre et communauté |
| B06 | Départ volontaire, dissolution et simulation J+7 | Carence conforme ; dissolution pénalise seulement le capitaine déclencheur |
| B07 | Capitaine inactif : simulation 30j puis transfert en recette autorisée | Successeur actif le plus ancien, créateur historique conservé ; dry-run sans écriture |
| B08 | Attribuer défi solo, retenter avant 12h, déposer avant/après 48h | Cooldown/expiration respectés, preuve ancienne refusée selon règles |
| B09 | Lire le code TWR-XXXX et fournir la preuve associée | Disponible uniquement lorsque T9 est développé/configuré ; sinon Non exécuté, pas de faux succès |
| B10 | Défi d'équipe : confirmer participants, attribuer deux fois le même jour | Même tentative, seuls participants éligibles bénéficient de la récompense |
| B11 | Auteur/participant tente de voter, puis trois vrais votants | Auto-vote et vote participant refusés ; scrutin de 24h, quorum et majorité appliqués |
| B12 | Égalité, deux votants, vote tardif, double clic | Pas de validation sans majorité/quorum ; aucune double écriture |
| B13 | Valider plusieurs preuves solo/équipe en concurrence, près de minuit Paris | Deux réussites récompensées/jour au maximum, report et idempotence conformes |
| B14 | Contester dans/après 7j, motif vide, preuve de Maxime | Auteur autorisé, motif obligatoire, délai appliqué ; récusation et décision indépendante, aucune double récompense |
| B15 | Simuler preuve sans quorum à J+7 puis J+30 | Signalement staff unique, archivage sans récompense ni effacement |
| B16 | Simuler fin saison, intersaison, été→S4 et heure d'été/hiver | Étages permanents conservés, classement/départage corrects, scrutin existant non perdu |
| B17 | Seuils Ranker30, HighRanker100 sans/avec saison terminée | Rang produit visible conforme, aucun pouvoir admin |
| B18 | Soirée/tournoi fictif : inscription, rappel, résultat, annulation | Historique conservé, notifications cohérentes et uniques dans la recette autorisée |
| B19 | Préférences de notification et affichage mobile/clavier | Opt-out respecté, boutons accessibles, messages lisibles |

B14/B15 restent Non exécutés tant que T10/T11 ne sont pas livrés. Ne pas créer de fausse activité Production pour compléter le tableau.

## Formulaire de bug à copier dans le canal de retour choisi

- Identifiant : BETA-AAAA-NNN
- Scénario Bxx / titre court :
- Date et heure UTC :
- URL sans code OAuth ni paramètre sensible / SHA :
- Appareil, navigateur, taille écran :
- Rôle du compte fictif (auteur/votant/capitaine/arbitre) :
- Étapes précises : 1… 2… 3…
- Résultat attendu :
- Résultat observé / message exact nettoyé :
- Reproductible : toujours / parfois / une seule fois
- Gravité proposée : bloquant / majeur / mineur
- Capture nettoyée : aucune adresse privée, message privé, clé, cookie ou token

Stop immédiat si donnée d'une autre communauté, secret ou effet Production observé : ne pas recopier la donnée, prévenir l'organisateur par le canal convenu et suspendre ce scénario.

## Registre des retours

| ID | Scénario | Gravité | SHA observé | Statut | Responsable | PR corrective | SHA retesté | Preuve retest |
|---|---|---|---|---|---|---|---|---|
| À renseigner | | | | nouveau | | | | |

Statuts : nouveau → reproduit → correction en brouillon → CI réussie → retest humain réussi → clos. Ne pas fermer sur la seule CI. Bloquant : fuite, corruption, accès indu, récompense double ; majeur : parcours essentiel impossible ; mineur : présentation ou gêne contournable. Tout reclassement est motivé.

## Bilan de sortie

Comptabiliser réussis/échecs/non exécutés, bugs ouverts par gravité et parcours absents. Aucun bloquant sécurité/isolement/récompense ; parcours critiques rejoués sur le SHA candidat ; relecture Claude et accord propriétaire avant activation. Ce kit ne vaut ni recrutement effectué ni bêta réussie.
