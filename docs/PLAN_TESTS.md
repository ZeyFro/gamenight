# Plan de tests par rôle

> Pour le propriétaire, avant et pendant l'ouverture. Relevé du 22 novembre 2026. Chaque test dit : ce qu'il faut faire, ce qu'on doit voir, et la preuve à garder (une capture d'écran, sauf mention contraire). Les tests marqués **« humain »** ne peuvent pas être faits par un robot : ils demandent un vrai compte, un vrai téléphone ou un vrai serveur Discord.

**Avant de commencer.**
- Range les captures dans un dossier `preuves/AAAA-MM-JJ/`, nommées `rôle-numéro.png` (exemple : `visiteur-02.png`).
- Une capture doit montrer l'adresse de la page et l'heure.
- Ne capture jamais un secret, un jeton ou l'écran des variables Vercel.
- Les tests qui écrivent dans Discord (annonces, MP, mentions) se font **dans un salon de test**, avec des comptes qui sont d'accord.

**Ce qui est éteint aujourd'hui.** Voir la [fiche de l'application](FICHE_APPLICATION.md), section 3. Un test sur une fonction éteinte doit montrer « page introuvable ». Ce n'est pas un échec : c'est le résultat attendu.

---

## 1. Visiteur (pas connecté)

Utilise une fenêtre de navigation privée.

| # | Parcours | Résultat attendu | Preuve |
| --- | --- | --- | --- |
| V1 | Ouvrir `/` | Page de connexion avec le bouton Discord et les trois liens légaux en bas. | Capture |
| V2 | Ouvrir `/mentions-legales`, `/confidentialite`, `/conditions` | Les trois pages s'affichent. On y voit l'éditeur, le contact, l'âge minimum (13 ans) et « Dernière mise à jour ». Aucun « À COMPLÉTER ». | 3 captures |
| V3 | Ouvrir `/admin`, `/admin/tableau-de-bord`, `/tower`, `/sessions`, `/profil` | Retour à la page de connexion, ou « page introuvable ». Jamais de donnée. | Capture de chaque |
| V4 | Ouvrir `/api/compte/export` | Message « refusé » (401). | Capture |
| V5 | Ouvrir `/admin/discord-commands` | « Page introuvable » (tant que l'interrupteur est éteint). | Capture |

## 2. Nouveau membre — **humain**

Il faut un **compte Discord neuf** (jamais connecté à GameNight), membre du serveur The Tower.

| # | Parcours | Résultat attendu | Preuve |
| --- | --- | --- | --- |
| N1 | Se connecter avec un compte Discord **qui n'est pas** dans le serveur | Connexion refusée, message clair. | Capture |
| N2 | Se connecter avec le compte neuf, membre du serveur | Arrivée sur `/bienvenue`. | Capture |
| N3 | Finir `/bienvenue` (choisir des jeux) | Arrivée sur l'accueil ; les jeux apparaissent dans `/bibliotheque`. | 2 captures |
| N4 | Ouvrir `/tower` | Les défis s'affichent, ou un message clair s'il n'y en a pas encore. | Capture |
| N5 | Même parcours **sur téléphone** (Android et iPhone si possible) | Tout s'affiche sans déborder. La barre du bas fonctionne. Les boutons sont faciles à toucher. | Captures mobiles |
| N6 | Quitter le serveur Discord, puis revenir sur le site le lendemain | L'accès aux données du serveur est coupé. | Capture |

## 3. Régulars (membre de base)

| # | Parcours | Résultat attendu | Preuve |
| --- | --- | --- | --- |
| R1 | Créer une soirée dans `/sessions` et inviter 2 membres | La soirée apparaît. Les invités la voient. Une annonce part dans le salon de test si les annonces sont allumées (**humain** : vérifier dans Discord). | Captures site + Discord |
| R2 | Proposer 2 jeux et voter | Le vote se clôt et un jeu est retenu. | Capture |
| R3 | Écrire dans le chat d'une soirée | Le message s'affiche pour les invités, pas pour les autres. | Captures des deux comptes |
| R4 | Lancer une roulette dans `/roulette` | Un jeu est tiré. | Capture |
| R5 | Créer un tournoi de 4 joueurs et saisir un résultat | Le tableau avance. | Capture |
| R6 | Recevoir un défi dans `/tower`, déposer une preuve | La preuve est en vote. Elle est annoncée dans le salon des preuves si tu as donné ton accord (**humain**). | Captures site + Discord |
| R7 | Voter sur la preuve d'un autre (compte présent depuis au moins 7 jours) | Le vote compte. Il est refusé pour un compte trop récent. | 2 captures |
| R8 | Lier son compte Steam dans `/profil/parametres` | Retour sur la page avec « Steam lié ». Les jeux apparaissent après la synchronisation. | Capture |
| R9 | **Export** dans `/profil/compte` | Un fichier JSON se télécharge. Il ne contient que tes données, sans jeton. | Capture + fichier (à garder privé) |
| R10 | **Suppression** dans `/profil/compte`, avec un compte **de test** seulement | Il faut taper son pseudo ou « SUPPRIMER ». Ensuite, le compte devient « Ancien membre », la reconnexion crée un compte neuf, et les soirées passées restent. | Captures avant et après |

## 4. Irregular

Le grade est donné à la main par l'équipe.

| # | Parcours | Résultat attendu | Preuve |
| --- | --- | --- | --- |
| I1 | Un admin donne le grade (aujourd'hui sans page : `TOWER_IRREGULAR_GRANTS_ENABLED` est éteint) | Le grade s'affiche sur `/tower` et sur la fiche du membre. | Capture |
| I2 | Le membre Irregular ouvre `/admin` | Refusé : le grade ne donne **aucun** droit. | Capture |

## 5. Ranker (au moins 30 étages)

| # | Parcours | Résultat attendu | Preuve |
| --- | --- | --- | --- |
| K1 | Un compte de test atteint 30 étages | Le grade « Ranker » s'affiche. | Capture |
| K2 | Ouvrir `/tower/propositions` | « Page introuvable » tant que `TOWER_CHALLENGE_PROPOSALS_ENABLED` est éteint. Allumé : proposer un défi, au plus 2 par 24 h. | Capture |
| K3 | Un compte à 29 étages ouvre `/tower/propositions` (interrupteur allumé) | Refusé. | Capture |

## 6. High Ranker (au moins 100 étages et 5 défis validés dans la saison)

| # | Parcours | Résultat attendu | Preuve |
| --- | --- | --- | --- |
| H1 | Compte à 100 étages mais 4 défis validés dans la saison | Reste Ranker. | Capture |
| H2 | Le même compte valide un 5e défi | Devient High Ranker. | Capture |

## 7. Modérateur (droits Discord seulement) — **humain**

Le rôle n'existe pas dans le site. On teste les droits Discord.

| # | Parcours | Résultat attendu | Preuve |
| --- | --- | --- | --- |
| M1 | Un compte avec « Gérer le serveur » tape `/tower-admin` dans Discord (une fois les commandes enregistrées) | La commande répond, en privé. | Capture Discord |
| M2 | Un compte sans ce droit tape `/tower-admin` | Il ne voit pas la commande ou elle est refusée. | Capture |
| M3 | Clic droit sur un message → « Signaler » (si allumé) | Un ticket privé arrive dans le salon staff. Aucune sanction automatique. | Captures |
| M4 | Ouvrir `/admin` sur le site avec ce compte | Refusé s'il n'est pas dans la liste des admins. | Capture |

## 8. Admin

| # | Parcours | Résultat attendu | Preuve |
| --- | --- | --- | --- |
| A1 | Ouvrir `/admin` | Le tableau de bord s'affiche. | Capture |
| A2 | Trancher une contestation dans `/admin/tower-appeals` | La décision est enregistrée. Refusée si l'admin a lui-même voté ou participé. | Captures |
| A3 | Enregistrer les commandes (quand prêt : `docs/SOIREE_ACTIVATION.md` § 9 sexies) | Sur `/admin/discord-commands`, « Vérifier » affiche 13 commandes, puis « Enregistrer » les marque « enregistrée ». | 2 captures |
| A4 | Un admin **non** membre du serveur se connecte | Il entre, mais ne voit pas les données du serveur. | Capture |

---

## 9. Ce qu'un humain doit tester absolument

| Sujet | Comment | Preuve |
| --- | --- | --- |
| **Compte neuf** | Tests N1 à N6 avec un vrai compte Discord jamais utilisé. | Captures |
| **Mobile** | Un Android et un iPhone, en mode portrait. Parcours : connexion, soirée, Tour, profil. Vérifier que rien ne déborde. | Captures |
| **Suppression et export de compte** | Tests R9 et R10 avec un compte de test. Garder le fichier exporté en privé, puis le supprimer. | Captures + fichier |
| **Pings de rôles** | Créer une soirée de test. Le créateur reçoit un MP mais n'est **jamais** mentionné dans le fil. Aucun `@everyone` ni `@here` n'est envoyé par le bot. | Captures Discord |
| **Annonces automatiques** | Soirée : création, changement de date, « Soirée validée », rappel. Tournoi : création. Preuve et réussite de défi. Vérifier qu'une annonce arrive dans le bon salon, une seule fois. | Captures Discord |
| **MP fermés** | Un compte qui refuse les MP du serveur : le créateur reçoit une mention de secours, les autres non. | Capture |
| **Pages légales** | Relire les trois textes en entier. Vérifier que l'adresse de contact est bien celle que tu veux rendre publique. | Captures |

## 9 bis. Lignes « sans code » du cahier (12)

Ces lignes de [CAHIER_FINAL.md](CAHIER_FINAL.md) n'ont pas de code à tester : elles se prouvent par une action humaine, dans Discord ou sur le site. Elles sont regroupées dans le parcours **P6** de [RECETTE_PARCOURS.md](RECETTE_PARCOURS.md) (C109 et C118 dans **P1**). Le détail des étapes est dans [RECETTE_61_LIGNES.md § A1](RECETTE_61_LIGNES.md). Une ligne ne devient verte qu'avec un test réel d'un compte non-admin, daté et consigné (règle D1) : la capture d'un admin ne suffit pas.

| Ligne | Ce qu'il faut constater | Compte | Preuve |
| --- | --- | --- | --- |
| C104 | Le parcours complet du joueur, par les lignes déjà vertes des parcours P1 à P5 | Membre | Tableau récapitulatif daté |
| C108 | Organisation du serveur : noms, emojis, mobile, pas de salon vide, fils et panneaux | Membre | Captures mobile et ordinateur |
| C109 | Règlement, validation YAGPDB, rôle Régulars, comme un vrai nouveau membre | Compte neuf | Captures avant et après validation |
| C111 | Direction artistique (icône, bannière, panneaux, annonces) | Membre | Planche de captures et avis de Maxime |
| C112 | Éléments visuels harmonisés entre eux | Membre | Planche comparée, écarts listés |
| C115 | Atlas n'attribue plus d'étage (une seule source) | Maxime | Liste des bots, salon d'activité |
| C118 | YAGPDB valide le règlement et donne les rôles hors jeux | Compte neuf | Message YAGPDB, rôle obtenu |
| C120 | Ticket Tool : ticket privé ouvert puis fermé | Membre | Panneau, ticket, fermeture |
| C121 | Appy : une candidature arrive au staff | Membre | Candidature reçue côté staff |
| C123 | Anti-raid, anti-spam, contrôle des bots et applications | Maxime | Réglages AutoMod, vérification, bots |
| C125 | Exigences générales : mobile, aucune donnée d'une autre communauté | Membre | Captures mobile et SELECT en lecture seule |
| C127 | Développement communautaire : soirées hebdomadaires, créateurs, partenariats | Maxime | Liste datée des actions |

## 10. Quand arrêter

Arrête les tests et suis le [runbook](RUNBOOK.md) si tu vois :
- une page d'erreur 500 ;
- une donnée d'un autre membre qu'on ne devrait pas voir ;
- un message Discord envoyé plusieurs fois, ou un `@everyone` ;
- un compte hors serveur qui entre.
