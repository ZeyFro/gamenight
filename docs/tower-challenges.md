# Défis Discord — préparation du lancement

Ce lot est préparé localement à partir des PR #336 (défis solo) et #329 (équipes/ascension). Leur réconciliation n'est pas poussée et les deux PR restent distinctes pour leur revue. Il ne configure aucun serveur, n'applique aucune migration et n'active aucun envoi en Production.

## Parcours préparé
Le handler prépare un panneau dans l’application Discord GameNight avec **Mon défi**, **Ma progression**, **Défi d’équipe**, **Classement** et **Vote saison**, ainsi que les sous-commandes correspondantes. Rien n’est enregistré sur le serveur par cette PR. Un membre actif peut recevoir un défi solo toutes les 12 h et a 48 h pour le réaliser ; le défi d’équipe est attribué une fois par équipe et par jour de Paris, les membres actifs le rejoignent explicitement, et le groupe doit compter au moins deux participants avant le dépôt. La preuve passe par un lien vers son message dans le salon des défis. Le formulaire demande un consentement explicite avant le partage.

Une preuve soumise met en file un seul scrutin : 24 h, trois votants distincts minimum, majorité favorable, sans vote des participants au défi d’équipe ni vote pour soi. À l’échéance, un quorum insuffisant, une égalité ou une majorité défavorable clôt la preuve sans récompense. Après clôture et attribution, une seule intention d'annonce est créée pour le général. Le dépôt, la récompense et leurs intentions d'envoi partagent la même transaction ; un double clic ne double pas les étages. Le plafond est de deux réussites récompensées par membre et par jour de Paris, solo et équipe confondus. En cas de quota plein, la récompense approuvée d'un participant d'équipe reste en attente jusqu'au prochain jour local ; les autres membres éligibles avancent indépendamment.

La clôture automatique réutilise le cron protégé de l'exécuteur de notifications. À chaque passage il prépare aussi, de manière idempotente, les défis quotidiens des équipes actives. Il traite jusqu'à 25 preuves échues, y compris celles sans bulletin ou sans quorum, puis les récompenses de participants en attente. Un quota quotidien atteint retarde seulement l'attribution de la personne concernée jusqu'au prochain jour local. La cadence externe reste à vérifier au lancement ; aucun déclencheur n'est créé par cette préparation. Les résultats restent consultables dans Discord. Le catalogue de départ, le classement trimestriel et le vote de fin de saison sont codés mais ne sont pas déployés ni activés. La page `/tower` du site GameNight réunit l'ascension XP existante, la progression personnelle des défis, les défis en cours, les saisons et le top 10. Elle sépare les étages personnels reçus des défis de l'ascension XP. La page `/equipes` affiche, uniquement aux membres de chaque équipe, un score égal à la somme de l'XP GameNight de ses membres actifs et le détail classé par membre. Ce score est calculé depuis les stats de communauté existantes ; il n'ajoute aucune XP ni étage et ne modifie pas l'ascension Tower.

## Réutilisation et droits
Réutilisation de l'application Discord, des signatures d'interactions et de la file NotificationEvent/NotificationDelivery de GameNight. Aucun bot supplémentaire. Les publications vérifient à nouveau la communauté active, le consentement et l'appartenance active du participant ; la destination est vérifiée côté Discord par l'exécuteur existant. Aucune mention de rôle ou de membre n'est activée.

Le bot doit déjà disposer de Voir le salon, Envoyer des messages, Intégrer des liens et Lire l'historique dans les espaces retenus. Aucun droit Administrateur ni Gérer les rôles n'est requis par ce lot. La configuration du serveur demeure réservée à Claude conformément à la répartition validée.

## Activation future à valider
1. Revoir puis appliquer séparément la migration additive préparée dans cette PR.
2. Choisir un catalogue et activer la communauté concernée ; aucune autre communauté n'est concernée.
3. Renseigner les identifiants du serveur, du salon des défis et du général dans les variables documentées dans .env.example.
4. Activer les défis puis, séparément, les annonces. L'exécuteur de notifications existant doit lui aussi être activé.
5. Faire une recette privée autorisée avant le lancement de saison.

Les drapeaux sont désactivés par défaut. Aucun paramètre d'authentification Production n'est modifié. La file garantit l'unicité des intentions, pas une garantie absolue de livraison unique lorsque Discord accepte un message mais que sa réponse réseau est perdue.

## Commandes préparées
- `/tower defi` : attribution solo, réponse privée dans le salon des défis.
- `/tower equipe` : choisir une équipe active, voir son défi du jour et rejoindre le groupe de participants.
- `/tower progression` : étage, défis récents et dépôt de preuve par bouton.
- `/tower classement` : classement trimestriel.
- `/tower vote` : scrutin du trimestre achevé, ouvert au premier accès après la clôture.

La commande `/gamenight setup` conserve ses droits d'administration. Le fichier scripts/discord-commands.json ajoute /tower à la même application ; la commande n'est pas enregistrée réellement sur Discord par cette PR. Ne pas installer un autre bot. `/tower-admin importer-equipe` ajoute sans doublon les défis d'équipe de départ, après activation des équipes pour la communauté.


## Administration du catalogue solo (préparée)

La commande séparée `/tower-admin` est réservée à **Gérer le serveur** ; le serveur revérifie cette permission sur le corps d’interaction signé. Elle permet d’ajouter un défi (1 à 20 étages), de parcourir le catalogue avec `/tower-admin defis page:N` (12 défis par page) et de désactiver un défi. La désactivation n’efface ni son historique ni les tentatives déjà attribuées. Les opérations sont limitées à la communauté correspondant au serveur Discord configuré et active ; chaque requête utilise le client SQL isolé de cette communauté.

L’administration du catalogue reste possible pendant que le drapeau global des défis est éteint : cela ne distribue pas de défis et ne change pas le réglage communautaire. La commande doit être enregistrée et la migration appliquée séparément au lancement ; cette PR ne le fait pas. Les défis d’équipe ne sont pas inclus dans ce panneau et restent dépendants du modèle d’équipes existant dans la PR #329.


### Pack de départ

`/tower-admin importer` ajoute une fois les 12 défis solo réutilisables définis dans `src/lib/tower-challenge-starter-catalogue.ts`. `/tower-admin importer-equipe` ajoute le pack coopératif dans `src/lib/tower-team-challenge-starter-catalogue.ts`. Les deux imports sont idempotents : une entrée déjà présente, même volontairement désactivée, n'est ni dupliquée ni réactivée. Les défis demandent des preuves de jeu uniquement ; aucune photo de vie privée, dépense, mention ou action visant à humilier un membre n’est requise. Les imports n'envoient aucun message et ne mettent pas les défis en service.

## Classement saisonnier (préparé)

- `/tower classement` et le bouton **Classement** affichent le top 10 des étages remportés pendant la période Tower courante en heure de Paris. La convention commune est septembre–décembre, janvier–mars et avril–juin ; en juillet–août, le dernier classement reste consultable.
- Le classement est calculé depuis les défis validés et leurs récompenses dans la période : aucun compteur ou modèle supplémentaire n'est créé. Il repart naturellement à zéro à la prochaine fenêtre ; les étages cumulés du profil restent permanents (aucun retrait, remise à zéro générale, changement d'XP ou attribution de rôle).
- Seuls les membres actifs apparaissent. Le top 10 additionne les récompenses des défis solo et des récompenses individuelles d'équipe ; une récompense n'est comptée qu'une fois et aucun étage collectif n'est créé. Chaque réussite compte dans le même plafond de deux par jour de Paris.
- Les défis absurdes restent soumis aux règles de légalité et à la modération. Toute distinction de saison soumise à un vote communautaire doit rester distincte du vote qui valide une preuve.
- Vérification du calendrier : le [calendrier officiel 2026–2027 du ministère](https://www.education.gouv.fr/calendrier-scolaire-toutes-les-dates-des-cours-et-des-vacances-100148?annee=308) est publié par académie/zone ; Paris relève de la zone C et les vacances diffèrent entre zones. Les périodes Tower sont une convention trimestrielle commune, pas les trimestres officiels d'un lycée. Aucun calendrier d'établissement ou choix de zone par membre n'est enregistré. Le scrutin de fin de saison est décrit ci-dessous. Cette préparation ne constitue pas un lancement complet.


### Vote communautaire de fin de saison

Après la clôture d’un trimestre, le premier accès à **/tower vote** ou au bouton du panneau ouvre un scrutin unique de 48 h à partir des dix meilleurs du classement clos (au moins deux finalistes requis). Chaque membre actif dispose d’un bulletin, ne peut voter pour lui-même, et ne voit les résultats qu’à la clôture. Une égalité en tête ou l’absence de bulletin ne donne aucun gagnant. Seul un candidat ayant strictement plus de votes que les autres reçoit une distinction affichée : aucun grade, rôle Discord ou étage supplémentaire n’est attribué.

Le scrutin est isolé par communauté et trimestre, créé de façon idempotente et conservé avec les bulletins. Il n’envoie pas de notification publique ; les membres y accèdent dans le salon The Tower via le bouton du panneau ou /tower vote. Les notifications restent réservées aux annonces de preuves/réussites, derrière le drapeau existant.

Les commandes /tower defi, /tower progression, /tower classement et /tower vote sont préparées dans scripts/discord-commands.json et le handler. Elles ne sont pas enregistrées sur Discord par cette PR.
