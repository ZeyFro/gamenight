# Prix et téléchargement — L3-05

La fiche sépare deux sources : le prix de la boutique Steam en France et un
relevé de préparation déclaré par un joueur. Les deux peuvent concerner des
versions ou plateformes différentes ; ils ne s'écrasent pas mutuellement.

## Boutique Steam

Pour un jeu lié à un appid Steam, un encart chargé en streaming affiche le
statut explicite `is_free`, le prix formaté et la devise lorsqu'ils sont fournis.
`is_free:true` signifie gratuit ; `false` signifie payant. Champ absent/invalide
ou prix absent ne signifie jamais gratuit. Une promotion à zéro ne modifie pas
le statut du jeu. Les prix sont demandés avec `cc=fr` et `l=french`, et la région
France est affichée. Le lien boutique permet de vérifier l'offre de sa région.

Le contrat a été vérifié par lecture ciblée de l'[API officielle Steam](https://store.steampowered.com/api/appdetails?appids=620&cc=fr&l=french)
pour deux fiches : app620 (`is_free:false`, prix présent, EUR) et app570
(`is_free:true`, prix absent). Aucun montant commercial relevé n'est enregistré
dans le dépôt. L'API peut changer ou ne pas fournir de prix exploitable.

Le relevé et sa date ISO de collecte sont mis en cache ensemble avec l'appid
comme argument de clé, revalidation à une heure. La date affichée reste celle
du relevé en cache, même si une revalidation tarde. Le cache ne contient aucune
donnée utilisateur. Le dépôt n'active pas Cache Components : usage de
[`unstable_cache`](https://nextjs.org/docs/app/api-reference/functions/unstable_cache)
sans changer la configuration globale Next.js. L'appel Steam de ce parcours
dispose d'un signal d'expiration de cinq secondes. Une erreur est journalisée,
puis l'encart indique l'indisponibilité ; le reste de la fiche reste disponible.
Il n'y a ni reprise automatique ajoutée, ni collecte de toute la bibliothèque.
Les autres appels Steam existants conservent leur politique de délai.

Le client partagé expose désormais `isFree` et `priceCurrency`, et propose un
paramètre de région FR réservé au relevé de fiche. Son ancien champ
`priceFormatted` reste nullable et compatible avec les usages existants.
La détection coop et les écritures du backfill ne changent pas.

## Relevé des joueurs

Un possesseur connecté (`owned:true`) peut déclarer un statut gratuit/payant,
un prix avec devise si payant, un volume de téléchargement estimé, la
plateforme/version et un lien HTTPS vers la source. Tout coût ou volume connu
exige plateforme et source. Les champs sont bornés ; un prix associé à gratuit
ou inconnu est rejeté, et aucune écriture partielle n'est appliquée. Le volume
est positif, limité à 5 000 Go, avec deux décimales ; virgule et point sont
acceptés au serveur. Un Go désigne un milliard d'octets. Le relevé concerne le
téléchargement, jamais une conversion automatique de l'espace disque requis.

La source et la date de déclaration sont visibles. Ce sont des informations
déclarées, pas des valeurs vérifiées automatiquement auprès de la source.
Le lien de source n'est jamais téléchargé par le serveur. Les variantes selon
plateforme, version et mises à jour restent explicites. Il n'y a pas de mesure
de connexion, d'estimation de durée, de prix garanti ni d'inférence depuis le
nom du jeu. Les champs vides rétablissent l'inconnu ; aucune valeur zéro ne
masque une absence de données.

L'autorisation de possession fait partie du prédicat SQL d'écriture ; les
identités et autres métadonnées forgées dans le formulaire sont ignorées.
Authentification, rate limit et validation précèdent l'écriture. Une erreur de
base reste un échec. Le formulaire distingue succès, validation et panne puis
actualise la fiche après succès. Les autres métadonnées et les imports restent
conservés.

## Migration et contrôles

Migration additive `20261015213000_game_preparation` : six champs `Game`
nullable ; les jeux existants restent inconnus. Aucun modèle collectif modifié,
aucune dépendance ajoutée, aucune migration existante modifiée. Prisma
validate/generate et le diff de schémas sans connexion confirment le SQL.

Les quinze tests spécifiques locaux couvrent statut/prix absents, région,
devise, HTTP429, prix incohérent, date/cache, validation, possession, effacement,
liens et rendu des erreurs. Quatre cas PostgreSQL vérifient anciens jeux,
persistance, conservation des autres métadonnées, accès retiré et absence
d'écriture partielle. Ils sont ignorés localement faute de Docker/Postgres et
doivent passer sur le service jetable de CI. Tous les appels réseau des tests
sont simulés ; aucun accès Neon ou envoi Discord réel.

Suite locale complète : 1 565 tests réussis, 939 ignorés dans 229 fichiers.
Les quinze tests spécifiques et huit gardes ciblés réussissent ; quatre nouveaux
cas PostgreSQL sont ignorés. Typage TypeScript, lint et build webpack réussis.
Aucun délai ni mécanisme de reprise des tests n'est modifié.

Parcours authentifié/mobile non vérifié. La preview ne migre pas la base et ne
prouve pas le parcours en production. Lot indépendant depuis main486b39d ;
PR234–238 restent ouvertes. La fusion de #234 a été refusée par la revue
automatique pour défaut d'autorisation explicite reconnue comme fiable.
L'instruction du propriétaire de ne pas répéter l'action est respectée.
Réconcilier schéma, fiche jeu et roadmap avec les lots précédents puis rejouer
les contrôles sur le commit intégré avant toute fusion ultérieure.

## Reprise du 16 octobre

Le propriétaire a explicitement autorisé les fusions après contrôles. #234 et
#235 sont fusionnées, production READY vérifiée pour les deux. La présente
branche intègre le matériel de #236 et les avertissements de #238 ; les
conflits de schéma et de fiche jeu sont résolus en conservant les deux encarts.
Le guide explique les sources du prix et du volume. Le relevé déclaré utilise
l'horloge murale du dépôt et affiche son jour sans seconde conversion Paris ;
la date du relevé Steam conserve son interprétation d'instant réel.

Une relecture indépendante a repéré le double décalage près de minuit dans
les avertissements après adaptation de l'horloge. Un test a reproduit le
lendemain affiché à tort, puis la correction a réussi. La correction et un
test analogue sont présents pour le relevé de préparation : 19 tests ciblés
réussis sur quatre fichiers, dont les deux formulaires et actions. Validation
Prisma, typage et contrôles distants du nouveau HEAD à terminer avant fusion.
Les anciens statuts des PR ne valident pas cette intégration.

La checklist #240 reste Draft : CI38878492814, tentatives 1 et 2, échoue avant
checkout sur le quota de transfert du registre ECR. Aucun test Postgres n'y
a encore tourné. Reprise après résolution du quota :
`gh run rerun 38878492814 --repo ZeyFro/gamenight --failed`, puis
`gh pr checks 240 --repo ZeyFro/gamenight`. Ne pas boucler à l'identique.
