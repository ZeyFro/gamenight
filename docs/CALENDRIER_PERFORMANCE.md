# Calendrier tactile, création et ressources

## Point de départ et limites

Signalement : environ 24 secondes après « Créer », calendrier peu pratique sur
téléphone. Aucun accès aux métriques actuelles de production dans cette analyse.
Ce délai n'a donc pas été reproduit ni attribué à un manque de CPU/RAM.
Les améliorations ci-dessous ne constituent pas une mesure du délai final.

Le bilan `STABILISATION_V2.md` rapporte une capture Neon du 07/10 : Francfort,
38,67 Mo stockés, compute 0,25–4 CU, 46,58 CU-heures depuis le 01/10.
Les logs Vercel fournis précédemment exécutaient les fonctions à Washington
(`iad1`), même quand la requête était reçue à Francfort (`fra1`). Réception au
réseau et région d'exécution sont deux choses différentes.

## Modifications

| Parcours | Avant | Après |
| --- | --- | --- |
| Création avec G invités, isolation ON | Lecture du même parent, contrôle du membre et upsert pour chacun : 3G appels Prisma | 1 `createManyAndReturn` pour les invitations initiales, après filtrage et verrouillage des membres |
| Badges déjà récompensés | Une tentative `awardXp` et ses verrous/transaction par badge, terminée sur la contrainte unique | Une lecture groupée du ledger ; seules les récompenses absentes sont réparées |
| Calendrier semaine | Disponibilités/événements et calcul horaire sur toute la grille mensuelle (28–42 jours) | 7 jours seulement, mêmes contrôles de visibilité |
| Édition personnelle dans le calendrier | Deux lectures supplémentaires des disponibilités déjà chargées | Réutilisation des données du lecteur courant, indépendamment du filtre visuel |
| Créneau avec plusieurs personnes libres | La liste des personnes ne proposait pas de création | Bouton de création daté et à l'heure choisie dans cette liste |
| Timeline mobile | Défilement dans un panneau et petits boutons | Défilement de la page, cibles d'au moins 44 px, aucune remontée nécessaire pour créer |
| Déploiement Vercel | Pas de région fixée dans le dépôt | `vercel.json` fixe `fra1`, proche du Neon Francfort documenté |

Le nombre d'appels Prisma n'est pas forcément le nombre d'instructions SQL.
Les synchronisations Discord restent persistées dans la transaction métier,
une par invitation. Elles ne sont pas remplacées par des appels HTTP dans
l'action. Les clés de tentative, les verrous de Membership et la confidentialité
restent actifs. L'XP, les badges, leurs GIF et les confettis sont conservés.

**Avant de merger :** confirmer que la base Neon actuellement utilisée reste
à Francfort. La région proposée n'est pertinente que pour cette localisation.
Aucun réglage distant n'a été changé : la région prendra effet au déploiement
de cette PR. Pas de nouvelle migration, dépendance, cron ni flag.

## Mesurer les 24 secondes

Après déploiement, le contexte Vercel `perf:create-session` donne, en ms :
`authentication`, `validation`, `creationTransaction`, `rewards`,
`proposalAndLegacyNotice`, et `totalMs`. Aucun token, nom d'invité ni message
personnel dans ces mesures. Elles concernent une création confirmée, avant
navigation ; elles ne mesurent pas le téléchargement, l'hydratation ni le
rendu de `/sessions/[id]`. Les redirections de validation et les échecs avant
confirmation n'émettent pas ce bilan.

Relever cinq créations intentionnelles à trafic comparable : délai bouton →
réponse POST, délai réponse → page utilisable, heure exacte et request ID.
Comparer les médianes et les cas lents, sans créer des soirées en boucle pour
un benchmark de production. Vérifier une reprise de la même tentative sans
nouvelle session. Un indicateur « Création en cours » ne prouve pas une baisse
de latence.

## Dimensionnement et retour au gratuit

| Ressource | Conclusion actuelle | Preuve nécessaire avant changement |
| --- | --- | --- |
| Stockage Neon | Le volume historique est petit ; pas de besoin démontré d'augmenter le stockage | Usage actuel total, branches et rétention |
| CPU/RAM Neon | Le code répétait des transactions inutilement ; taille minimale suffisante non encore prouvée | CPU, mémoire, connexions et p95 des SQL pendant les vrais parcours concurrents |
| CPU/RAM Vercel | Les logs historiques ne prouvent pas de saturation | Mémoire maximale, CPU actif, durée, erreurs/timeouts sur le même déploiement |
| Région | Éviter un aller-retour intercontinental à chaque étape SQL séquentielle | Région Neon actuelle, puis logs d'exécution Vercel après déploiement |
| Temps de compute Neon | Les appels récurrents peuvent empêcher la mise en veille malgré moins de SQL par appel | Graphe actif/inactif, CU-heures sur 24–48 h et cadences réelles des jobs |
| Téléphone | Le calendrier avait un blocage d'interaction, distinct du temps serveur | Test sur un vrai téléphone, réseau mobile et trace navigateur |

L'offre Free annoncée par Neon au 09/10 comprend 100 CU-heures/mois et
1 Go de stockage par projet. **0,25 CU actif 24 h/24 pendant 30 jours =
180 CU-heures** : alléger les requêtes ne suffit pas à rentrer dans 100 si la
base reste éveillée en permanence. 100 CU-heures à 0,25 CU correspondent à
400 heures actives, sans compter les montées en charge. Ceci est un calcul,
pas une mesure de cette production ni une garantie d'éligibilité au gratuit.
Comparer aussi les limites de restauration et de branches avant un changement
d'offre. Ne pas désactiver les rappels/executor pour économiser sans avoir
prévu leur remplacement et testé leurs échéances.

Le graphe Neon et les journaux doivent établir si le cron chaque minute, les
onglets ouverts ou des jobs dupliqués maintiennent la base active. Cette PR
ne modifie pas leur cadence. Le benchmark synthétique historique à 100/1 000
communautés ne remplace pas ces mesures de trafic réel.

Sources officielles consultées le 09/10/2026 :
- [Régions des fonctions Vercel](https://vercel.com/docs/functions/configuring-functions/region)
- [Gestion du compute et mise en veille Neon](https://neon.com/docs/manage/computes)
- [Offre Free Neon mise à jour le 02/10](https://neon.com/blog/neon-free-plan-1-gb-per-project)

## Validation

Les tests couvrent la création depuis un créneau vide ou avec plusieurs potes,
le mode édition distinct, un geste vertical sans changement de jour, les sept
jours chargés, l'isolation des données d'édition, les invitations exactes et
la réparation du crédit de badge manquant. Le test Postgres de 20 badges
crédités exige zéro transaction de récompense puis exactement une transaction
si un seul crédit manque. La CI Postgres doit tourner en série sur sa base
jetable ; aucune connexion Neon ou notification Discord réelle.

À vérifier sur téléphone après déploiement : taper 20 h quand deux potes sont
disponibles, créer depuis le panneau, constater la date/heure préremplies,
faire défiler la page sans panneau qui capture le geste, créer une seule fois
et relever le temps réel. Répéter dans l'autre communauté pour contrôler le
serveur et les invitations. Garder les annonces Discord différées comme un
contrôle distinct du temps de création sur le site.
