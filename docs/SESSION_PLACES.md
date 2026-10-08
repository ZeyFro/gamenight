# Places et liste d'attente des soirées

Base = main, à vérifier avant de merger.

## Parcours livré

Sur une soirée **SCHEDULED**, avant son heure de début, le créateur peut activer
une capacité dans « Places et liste d'attente ». La capacité reste facultative :
les anciennes soirées et celles sans capacité conservent leurs participants
issus du vote. Les tournois, les roulettes encore en cours et « Jouer maintenant »
ne changent pas dans ce lot. Une soirée déjà décidée issue de roulette dispose
du même panneau que les autres soirées planifiées.

- À l'activation, les votants encore invités et membres actifs sont repris
  comme confirmés. Aucun vote n'est supprimé, modifié ni recréé.
- L'organisateur ne peut pas fixer une capacité inférieure aux places déjà
  confirmées, ni supérieure au maximum connu du jeu ou à 100.
- « Je participe » confirme si une place est libre, sinon inscrit en attente.
- « Me désister » libère la place. Le premier invité encore autorisé dans la
  file est promu automatiquement et reçoit une notification dans l'application.
- Une nouvelle inscription après désistement repart à la fin. Les clics répétés
  sur une inscription existante ne changent ni sa place ni son ancienneté.
- Augmenter la capacité promeut les suivants. Les inscriptions ferment au début
  de la soirée et pour toute soirée terminée ou annulée.
- Le rang, les places et les noms sont visibles aux personnes ayant accès à la
  soirée privée. La notification reste liée à sa communauté d'origine.

La promotion, la notification in-app et la mise à jour de l'annonce bot sont
posées dans la même transaction. Les messages Discord restent confiés à
l'executor existant : aucun appel HTTP Discord dans les actions d'inscription.
Ce lot ne crée pas de nouveau MP ou ping à chaque changement de place et
respecte les préférences de notification existantes.

## Accès, concurrence et intégration

Chaque mutation revalide l'accès privé et la communauté ; le verrou de ligne
sur Session sérialise les inscriptions simultanées, la capacité et le
désistement. Les invitations et appartenances utilisées sont verrouillées
pendant l'admission. SessionSeat hérite des droits de son parent Session.
Une clé unique `(sessionId, userId)` interdit les doubles inscriptions.

Un membre retiré ou une invitation révoquée est exclu de la lecture et de toute
nouvelle admission/promotion. Le retrait d'une invitation depuis l'application
déclenche la réconciliation de la file. Les changements d'appartenance Discord
sont réconciliés à la prochaine mutation de places ou au clic du créateur sur
« Actualiser la file » : pas de nouveau cron permanent dans ce lot.

Une fois les places activées, les participants utilisés pour les résultats,
pronostics, superlatifs et défis sont les confirmés. L'annonce bot affiche ce
nombre et les rappels utilisent les confirmés ; leurs contrôles existants de
membership, invitation et préférences restent appliqués à l'envoi.
La participation XP des nouveaux confirmés est attribuée à la fin via le ledger
existant ; les crédits historiques issus du vote ne sont ni supprimés ni doublés
par cette attribution. Il n'y a pas de remboursement rétroactif d'XP au désistement.

## Migration et validation

Migration additive `20261008210000_session_seats` : une colonne nullable,
une table de sièges avec ses contraintes, un enum et un index de file.
Aucune migration antérieure modifiée, aucune dépendance ou variable de production
modifiée. La capacité NULL conserve le comportement historique. Les FK en cascade
nettoient les sièges lorsque le parent ou le compte est supprimé.

Couverture :

- Calcul FIFO, confirmé conservé, départage stable, retrait et capacités invalides.
- Action : identité serveur, reconnexion, validation, rate limit, erreur récupérable.
- Composant DOM : double clic, état en attente, rang, désistement, capacité réservée
  au créateur, retry et fermeture.
- Onze intégrations Postgres : dernière place concurrente, promotion/notification
  unique, réinscription, retrait/invitation, isolation A/B, suspension, fermeture,
  capacité, conservation des votes, participants, rollback d'enqueue, cascades et
  répétition de migration sur lignes historiques dans un schéma jetable.
- Base locale indisponible : les intégrations seront exécutées dans le service
  Postgres 16 de CI, en série. Les résultats réels sont détaillés dans la PR.
- Build local avec Webpack et fontes temporaires hors dépôt (réseau Google Fonts
  indisponible) ; build normal exigé en CI/Vercel. Rendu PC/mobile, notifications
  réellement reçues et Discord réel restent à tester en environnement autorisé.

Avant merge : sauvegarder la production comme pour les migrations précédentes.
Le déploiement appliquera la migration existante dans cette PR. Une Preview
pointant sur une base non migrée n'est pas un environnement fonctionnel de test
pour cette nouvelle table ; utiliser une base de Preview isolée migrée, ou les
tests Postgres isolés et les contrôles après le déploiement autorisé.

Après déploiement : soirée décidée, activer deux places, inscrire trois invités,
vérifier le rang du troisième, désister un confirmé, vérifier sa promotion et
la notification, puis contrôler que les résultats excluent celui resté en attente.

## Suite distincte

Les boutons « je viens / je viens pas » dans les messages Discord, la capacité
dans le formulaire initial avant décision du jeu et la liste d'attente des
tournois / sessions spontanées ne sont pas implémentés par cette PR.
