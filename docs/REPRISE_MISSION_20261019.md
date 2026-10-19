# Point de reprise — GameNight, PC fixe, 19 octobre 2026

Ce fichier est publié après chaque lot. Échéance utilisateur : 20 octobre 2026 à 00 h Europe/Paris. Aucun périmètre Mangas Origines. Quota restant non observable : aucun pourcentage annoncé.

## État et contraintes persistantes

- Checkout racine C:/Users/Mousiouf/gamenight préservé sur feat/prix-telechargement-jeux, SHA73f2e1f; HANDOFF.md non suivi conservé. Trois anciens worktrees 23f2, 978b et a33e conservés et propres au relevé initial.
- Worktree de reprise : C:/Users/Mousiouf/.codex/worktrees/mission-fixe-20261019/gamenight, branche work/mission-fixe-20261019. Il poursuit sans réécriture la branche publiée work/mission-complete-20261019 de PR #290, base origin/main babf958 (#289).
- #290 était brouillon au SHA329fc2d, CI verify et Vercel/Preview Comments SUCCESS. Métadonnées Vercel READY confirmées pour ce SHA. Les nouveaux commits doivent obtenir leurs propres contrôles avant fusion.
- L'utilisateur autorise explicitement fusion après tests adaptés, revue et contrôles requis verts au dernier SHA, puis vérification du déploiement. Pas de force-push, contournement ou migration Production.
- Toute écriture de recette reste sur PostgreSQL local; jamais de message Discord réel, activation de flag Production, désactivation protection Vercel ou nettoyage distant. Ne récupérer aucune ancienne Preview et ne supprimer aucune branche Neon.
- Les recettes authentifiées #289 sont acquises et ne sont pas rejouées.

## Lot #290 — permissions et classements

- Galerie et chronique : créateur ou ADMIN/OWNER communautaire déjà autorisé à accéder à la soirée privée. Un admin sans invitation reste refusé; le seul rôle admin global ne donne aucun droit de gestion.
- Lore communautaire Fame/Shame : ADMIN/OWNER. Il n'existe aucun lien soirée dans ce modèle, donc être créateur d'une autre soirée n'accorde aucun droit global.
- Musée : formulaires réservés aux personnes réellement autorisées côté serveur. Classements : temps déclaré, nombre de soirées rejouées et régularité, isolés par communauté.
- Tests PostgreSQL PC fixe : chroniques + highlights 16/16 en série après vérification du conteneur/binding/base. Tests unitaires supplémentaires et contrôles finaux consignés dans la PR et le tableau.
- Nouvelle recette scripts/recette-contenus.mjs passée sur Next local3102 + cinq comptes : gestion créateur/admin invité, lecture membre et admin global, admin tiers 404, modification chronique et publication musée persistées, révocation immédiate, musée mobile390x844 sans débordement et zéro NotificationDelivery pour la soirée.
- La recette n'envoie aucun Blob. Le stockage réel et les clips réels restent une validation externe manquante. AUTH_SECRET éphémère en mémoire, cookie local synthétique; ceci ne valide pas OAuth Discord réel.
- Dépendances existantes réutilisées par junction; aucun npm ci. Next dev utilise --webpack car Turbopack refuse les junctions hors de sa racine. Le script arrête seulement son propre serveur et navigateur; fixtures locales conservées.

## Suite indépendante

- Grades/boutique : défaut confirmé, l'achat décrémente actuellement xpTotal utilisé par les rangs. Choix utilisateur explicite : conserver la progression lors d'un achat. Correctif séparé fix/xp-balance-20261019, worktree C:/Users/Mousiouf/.codex/worktrees/xp-balance-20261019/gamenight; solde distinct, initialisé au total actuel, sans restitution historique inventée.
- Cette séparation ajoute une migration. scripts/build.mjs exécute migrate deploy hors Preview : PR BROUILLON uniquement, aucune fusion tant que migration Production interdite. Les autres paramètres économiques existants sont conservés, sans nouvelle pénalité arbitraire.
- Offres gratuites automatiques : absence confirmée; curation manuelle seule. Le GET Node GamerPower depuis ce PC répond200 (Steam et Epic) : ancien problème TLS du portable non reproduit, aucune protection TLS désactivée. Source autorisée avec attribution, mais API pouvant contenir des offres à points et des dates N/A; filtre d'éligibilité nécessaire. Recherche Epic primaire accessible depuis Node, pas de contrat public stable présumé.
- Pas de quiz de connaissances distinct à ajouter : le quiz carnet Tryharder/Ambianceur/Stratège/Chaos est livré; rester dans la demande initiale.
- Tableau exhaustif : docs/MISSION-20261019.md (exigence → code → tests → recette → activation → preuve/blocage). Les anciennes preuves du portable y sont conservées. Présent dans le code ne signifie pas activé ou validé réellement.

## PostgreSQL et coordination

- Conteneur conservé gamenight-test-pg, uniquement127.0.0.1:55439, base gamenight_test. Identité vérifiée par current_database() et aucune connexion concurrente avant première écriture. Les deux migrations déjà publiées iCal/annulation ont été appliquées uniquement à cette base locale.
- Toujours un seul processus de tests PostgreSQL; les suites historiques partagent/vident des tables. Chaque agent doit demander le créneau au coordinateur et le libérer explicitement.
- Le worktree XP dispose de son propre client Prisma, isolé des dépendances partagées; hash partagé23f2 inchangé après génération.

## Interventions externes à distinguer

- Blob privé : configuration et vraie lecture/envoi médias non validés; aucun token réel utilisé.
- Discord : vérifier manuellement les vrais messages/rappels/RSVP, canaux et vocal; textes définitifs plus tard. Aucun envoi réel ici.
- Push : VAPID et opt-in navigateur réels à configurer/valider; aucune activation Production.
- iCal : import tiers Google/Apple non effectué; abonnement local/jetons peuvent être testés isolément.
- Vercel : Chrome Production est authentifié pour recette read-only. Le connecteur lit les métadonnées sans team explicite; accès Preview protégé et portée équipe restent une limitation déjà documentée. Ne pas reconnecter ni modifier protection sans nécessité.
