# Soutiens Nitro (boosters)

Flag : `DISCORD_BOOSTERS_ENABLED` (OFF par défaut). Migration `20261118131200_booster_support` (tables `BoosterSupport` et `BoosterSupportSpace`, additives). **Strictement cosmétique** : aucun XP, étage, vote, quota ni classement (voir `BOOSTER_FORBIDDEN`, `src/lib/boost-perks.ts`).

## Fonctionnement

- Cron `GET /api/cron/booster-sync` (`CRON_SECRET`, 503 sans secret, 202 + `after()`, `maxDuration` 60, **aucun cron créé** : cadence externe, par exemple toutes les 30 minutes). Lecture REST `GET /guilds/{id}/members/{id}` (`premium_since`), sans gateway ni intent privilégié, par lots rotatifs de 100 membres actifs de GameNight (les moins récemment vérifiés d'abord). Limite de débit : arrêt du passage. Autre erreur : état inchangé (jamais de retrait sur un doute). Membre parti du serveur (404) : fin de soutien. Un verrou `CronLock` évite deux passages simultanés.
- Chaque changement est enfilé (événement ADMIN `BOOSTER_SUPPORT_SYNC` + livraison BOT, 10 minutes d'idempotence) et exécuté par l'executor (`sync_booster_support`) : **aucun appel Discord en écriture dans le cron**.
- Rôle « Soutien de la Tour » : créé une fois **sans aucune permission** (couleur `#b99aff`), attribué au début du boost, **retiré automatiquement** à la fin (ou si le membre quitte la communauté GameNight).
- Salons : un salon écrit `soutiens-de-la-tour` et un salon vocal « Soutiens de la Tour », invisibles de @everyone, visibles du seul rôle (voir, écrire, lire / se connecter, parler). Retrouvés par nom ; un salon homonyme public ou un rôle homonyme avec permissions n'est jamais adopté (refus `unmanaged`). Aucune suppression. Refus (`capacity`) à 250 rôles ou 500 salons.
- Badge et halo du profil (existants, `BoosterBadge`) : alimentés par l'état stocké quand le flag est ouvert (sans appel Discord).
- Mur des soutiens : page `/soutiens` (404 flag fermé), membres actifs boostant, profils masqués exclus, aucun classement.

## À faire par Maxime

Activer le flag après les migrations, vérifier que le rôle du bot est au-dessus de « Soutien de la Tour » et qu'il a « Gérer les rôles » et « Gérer les salons », planifier le cron externe. Les rôles/salons créés ne sont jamais supprimés par le code.

## Limites

Lecture par membre GameNight lié (un appel REST chacun) : un booster sans compte GameNight n'est ni vu ni récompensé. Le délai de prise en compte dépend de la cadence du cron.
