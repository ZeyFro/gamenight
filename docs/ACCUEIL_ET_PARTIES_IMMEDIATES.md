# Accueil assisté et annonce « Jouer maintenant »

Base = main, à vérifier avant de merger.

## Accueil

Le layout authentifié propose un popup et un accès « Compléter mon profil ».
L'ancien booléen `onboardingCompleted` n'est plus utilisé pour cacher les
réglages manquants. `/bienvenue` vérifie Steam et les disponibilités réellement
enregistrées, puis présente bibliothèque de groupe, tierlist, soirées,
calendrier, roulette maintenant/plus tard, parties immédiates, tournois et
progression par serveur. Il s'agit d'un assistant avec étapes et liens, pas
d'un surlignage interactif superposé à chacun des écrans de l'application.

- Steam : compte lié ou choix explicite « Je n'utilise pas Steam ».
- Planning : au moins un créneau récurrent ou une exception non périmée,
  y compris une indisponibilité déclarée. Pas de créneau fictif ajouté.
- Suivant ne valide aucun réglage. Terminer exige les deux réglages côté
  serveur. Fermer/Plus tard n'écrit pas `onboardingCompleted`.
- Le popup ne recouvre pas le formulaire planning, les paramètres Steam,
  le sélecteur de serveur ou le guide. Fermer le reporte dans cet onglet ;
  le bouton d'accès reste affiché et une nouvelle session d'onglet le retrouve.
- Comptes existants incomplets inclus. Steam/planning sont des réglages
  personnels communs aux serveurs ; aucune nouvelle liaison demandée en
  changeant de communauté. XP/badges restent inchangés.

Un unique MP de bienvenue par compte est mis en file après le rendu,
sans ralentir la liaison Steam avec un appel Discord synchrone. Il contient
les liens des seules étapes encore manquantes au moment de la livraison.
Le lien planning ouvre `/disponibilites` ; le lien Steam ouvre le guide
à cette étape, puis le véritable endpoint de liaison Steam.
Les liens conservent leur destination après la connexion Discord.
Le MP exige un Membership/Community ACTIVE, le bot et l'executor configurés,
et respecte `silenceReminders`. Les préférences de soirées/roulettes ne sont
pas utilisées pour détourner leur sens. Les MP fermés restent gérés par
l'executor ; le guide dans l'application reste disponible. Aucun nouvel
essai de bienvenue à chaque connexion après un envoi ou un échec terminal.

Le choix sans Steam et le reçu du MP utilisent le journal ADMIN existant
(`ONBOARDING_STEAM_CHOICE` / `ONBOARDING_REMINDER`, source = id du compte).
Ils ont une occurrence vide durable, conservée par la rétention existante.
Le reçu du MP porte le serveur actif d'origine, le choix Steam est personnel.
Pas de nouvelle table, migration, dépendance ou clé secrète.

## Partie immédiate

Auparavant, seules les personnes sélectionnées recevaient un MP et une
notification interne. Sans invité, aucun message ne permettait aux autres
de découvrir la partie dans le salon Discord.

Une nouvelle partie, y compris issue de la roulette immédiate, met maintenant
en file une annonce dans le salon SESSION de sa communauté, même sans MP
sélectionné. Cette partie étant ouverte au serveur, l'annonce est publique.
Les soirées planifiées privées ne changent pas de confidentialité.

- Créateur, jeu et lien « Rejoindre la partie » vers l'id exact.
- Aucune mention ni `@everyone` (règle roulette conservée).
- Après OAuth, retour sur cette partie, pas sur l'accueil.
- Le membre peut la rejoindre même si son sélecteur affiche un autre serveur
  dont il est aussi membre. Le choix de serveur n'est pas modifié par le lien.
- Un membre d'un autre serveur sans accès à cette communauté est refusé.
- Destination du parent, jamais celle du lecteur : configuration relue,
  absence de repli interserveurs, vérification guild/salon avant le POST.
- Changement de jeu et fin : édition du message existant, sans nouveau SEND.
  À la fin, retrait du lien de participation ; une ancienne URL est également
  refusée par la mutation serveur. Une publication initiale périmée est refusée.
- Double soumission avec la même clé de création : une partie et une annonce.

Configuration existante : `DISCORD_BOT_SESSION_ANNOUNCE_ENABLED=true`,
destination SESSION valide, bot autorisé et `NOTIFICATION_EXECUTOR_ENABLED=true`
avec son cron. Les MP instantanés gardent leur flag indépendant.
La file implique un délai jusqu'au prochain passage du cron, pas une promesse
d'envoi instantané. Aucun flag de production n'est modifié dans cette PR.
Un SEND sans salon disponible est retenté dans les limites de l'executor.
Les anciennes parties ne sont pas annoncées rétroactivement.

## Validation

Les tests DOM vérifient le popup, la fermeture sans validation, le parcours,
le choix sans Steam, les échecs serveur et la reprise au planning.
Les tests de liens simulent OAuth et conservent la destination interne.
Deux suites Postgres isolées couvrent : connexions concurrentes/un seul MP,
silence, retrait, étapes complétées pendant l'attente, identité authentifiée,
exception périmée, création/replay sans invité, isolation A/B, join autorisé
et refusé, arrêt/expiration, salon désactivé et refus HTTP simulé d'un salon
Discord appartenant à un autre serveur.

Les résultats exacts de CI/build du commit final sont consignés dans la
description de la PR après les checks, séparément des contrôles réels.
Localement, Postgres n'est pas disponible : ces scénarios sont explicitement
ignorés et leur validation revient au service Postgres 16 isolé de CI.
Tous les échanges Discord/OAuth des tests sont simulés.

## Contrôles réels après merge et Ready

1. Compte incomplet : popup, lien Steam, lien planning, guide PC/mobile.
   Fermer puis reprendre ; vérifier qu'un réglage absent reste à terminer.
2. Renseigner le planning puis lier Steam ou choisir sans Steam ; terminer
   le guide. Le popup ne revient plus sur le profil complet, même sur B.
3. Compte incomplet avec MP ouverts : attendre le cron, recevoir un seul MP
   avec les liens manquants ; se reconnecter sans recevoir un doublon.
   MP fermés/silence : guide toujours disponible dans l'application.
4. Sur The Tower, créer « Jouer maintenant » sans personne sélectionnée.
   Attendre l'annonce dans son salon soirées ; aucun message dans default.
5. Depuis un second membre de The Tower, suivre le lien et rejoindre.
   Tester aussi déconnecté : après OAuth, retour sur la même partie.
   Un compte seulement membre de default ne doit pas y accéder.
6. Changer le jeu puis terminer : le même message est édité, le lien est
   retiré ; un ancien lien ne permet plus de rejoindre.

Aucune manipulation SQL ni nouvelle commande slash nécessaire.
