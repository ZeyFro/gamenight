# Recette navigateur médias et parcours (fixe 2, 2026-10-20)

Base : `main` 3e0731b. Vrai Edge headless, vrai Next dev (`--webpack`, 127.0.0.1:3117), PostgreSQL Docker dédié `gamenight-fixe2-browser-pg` (127.0.0.1:55447, base `gamenight_fixe2_browser`, 111/111 migrations appliquées, cible revérifiée par `current_database()` et l'IP du conteneur avant toute écriture). Comptes fictifs, JWT Auth.js signés avec un secret éphémère.

## Lancement

```powershell
# playwright-core hors dépôt dans %TEMP%\gamenight-fixe2-browser-tools ; aucune dépendance ajoutée
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/recette-medias.ps1                                    # galerie
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/recette-medias.ps1 -Script scripts/recette-parcours.mjs # veto, MVP, boutique, calendrier, mobile
```

Un seul serveur Next à la fois ; le script le démarre et le tue (`taskkill /T`). Les preuves (captures, `preuve.json`, `next.log`) vont dans `logs/<run>/` (ignoré par git).

## Galerie, captures, clips (`recette-medias.mjs`) : réussi

Transport Blob SIMULÉ : un serveur loopback 127.0.0.1:3118 remplace Vercel Blob (`VERCEL_BLOB_API_URL` + préchargement undici qui réécrit les hôtes Blob et refuse tout autre HTTP externe). Aucun Vercel Blob réel n'a été appelé.

Preuves (10 contrôles) : envoi PNG (16 868 o) puis MP4 H.264 (2 289 o) octets identiques au Blob simulé ; image décodée (`naturalWidth > 0`) ; vidéo lue (`currentTime > 0`) ; `Range: bytes=0-15` -> 206 + `Content-Range` + `no-store` ; Range hors fichier -> 416 ; tiers non invité -> 404 ; invité révoqué -> 404 ; invité sans bouton « Supprimer » ; mobile 390x844 sans débordement ; suppression base + Blob (2 PUT, 1 DELETE) ; 0 `NotificationDelivery` ; 0 `pageerror`.

Défauts du harnais corrigés (pas de l'application) : le transport du SDK Blob passe par `vercel.com/api/blob` (non réécrit) -> ajout de `VERCEL_BLOB_API_URL` ; le statut « Galerie mise à jour. » du premier envoi restait affiché et validait le second -> attente sur la ligne en base ; l'input fichier était réinitialisé par le rechargement -> attente de `?gallery=ok` + `networkidle` ; le bouton « Supprimer » ciblé était celui de la soirée -> restreint aux `figure`.

## Parcours (`recette-parcours.mjs`) : 29/29 étapes

Les scripts publiés existants (`recette-locale`, `recette-contenus`, `recette-bracket-equipes`) ne couvrent ni veto, ni MVP, ni boutique, ni calendrier : ces parcours sont les manques testés.

| Domaine | Vérifié |
| --- | --- |
| Veto (`VOTE_VETO_ENABLED=true`) | 2 jeux JOUABLES, pose (toast, badge VETOÉ, base), remplacement (1 par personne), refus du dernier jeu restant (message d'échec, base inchangée), retrait, état vide sans bouton, compte hors communauté sans accès |
| MVP / superlatifs | invité non participant : message sans formulaire ; hors communauté : 404 ; bouton désactivé tant que non choisi, pas de vote pour soi ; votes simultanés de 2 participants qui clôturent en concurrence : 1 award, 2 voix, aucun doublon `XpEvent` ; « Forcer la clôture » réservé au créateur ; clôture sans vote : « Personne n'a voté » |
| Boutique XP | achat 200 XP (300 -> 100, `XpEvent` -200, objet possédé), solde insuffisant (message, rien débité), équiper puis retirer, double achat concurrent sur 2 onglets (250 XP, objet 250) : 1 achat, solde 0, 1 `XpEvent`, compte sans communauté renvoyé vers `/profil` |
| Calendrier | jour sélectionné exposé par `aria-label` sans `aria-pressed` (#308), soirée visible, vue semaine = 7 jours, formulaire « date importante » réservé OWNER/ADMIN, anniversaire partagé (année ramenée à 2000, absente de l'URL), date importante créée, export `.ics` : membre 200 `text/calendar`, anonyme 401, hors communauté sans la soirée |
| Mobile 390x844 | pas de débordement horizontal (scrollWidth 390 <= 390) sur : soirée avec veto, vote MVP, résultats MVP, boutique, calendrier mois et semaine |
| Transverse | 0 `NotificationDelivery` pour les sources de cette communauté, 0 `pageerror` |

Les autres parcours n'ont pas révélé de défaut applicatif. Le débordement mobile de la roulette, détecté puis corrigé pendant cette recette, est décrit plus bas.

Portée historique du test MVP : les catégories de superlatifs sont globales, pas propres à une communauté. Les versions précédentes du harnais désactivaient les catégories existantes et laissaient active leur catégorie de recette. Le harnais corrigé photographie puis restaure les états `active` initiaux et supprime seulement sa catégorie temporaire ; ce parcours ne teste pas une gestion des catégories par communauté.

## Tests sautés et limites (à lire)

- Veto avec le flag éteint (`VOTE_VETO_ENABLED` absent) : NON exécuté dans ce navigateur (le serveur est lancé avec le flag allumé) ; couvert seulement par les tests unitaires/intégration existants.
- Roulette (asynchrone, instantanée) et veto de roulette : non testés ici.
- Abonnement calendrier privé (`CALENDAR_SUBSCRIPTIONS_ENABLED`) : non testé (flag éteint).
- Rôle ADMIN (distinct d'OWNER) du calendrier : non testé ; seuls OWNER et MEMBER le sont.
- Droit de la server action `createCommunityDateAction` par un MEMBER : seule l'absence du formulaire est vérifiée en navigateur, pas un POST forgé.
- Hors communauté, une soirée renvoie HTTP 200 avec la page « 404 » rendue (corps « Introuvable ») pour les pages de vote ; l'export `.ics` répond 200 sans la soirée. Le contenu n'est pas exposé.
- Les captures mobiles vérifient le débordement, pas l'esthétique.
- Le transport Blob simulé et l'absence d'appel externe ne valident pas Vercel Blob réel, ni Discord, ni Web Push, ni OAuth Discord : aucune de ces intégrations n'a été appelée (simulation != validation réelle).
- Next en mode `dev` (webpack), pas le build de production.

## Compléments (`recette-complements.mjs`) : 21/21 étapes

Deux serveurs Next successifs (jamais en parallèle) : phase A `VOTE_VETO_ENABLED` + `CALENDAR_SUBSCRIPTIONS_ENABLED` allumés, phase B tous flags éteints. Lancement : `... recette-medias.ps1 -Script scripts/recette-complements.mjs`.

| Domaine | Vérifié |
| --- | --- |
| Roulette asynchrone tirée | résultat et bouton veto pour un participant ; invité non participant sans bouton ; autre communauté sans le jeu |
| Veto de roulette | relance sans le jeu vetoé (roulette, soirée et proposition à jour), un seul veto par personne, échec explicite « aucun autre jeu à tirer » quand tous les jeux sont vetoés |
| Veto flag OFF | aucun bouton sur la soirée de vote (jeux toujours JOUABLES) ni sur la roulette, résultat inchangé, 0 veto en base |
| Abonnement calendrier | création d'un lien privé, flux `.ics` sans cookie (`no-store`, `noindex`), soirée d'une autre communauté absente, renouvellement invalide l'ancien lien, révocation, lien malformé 404, jeton stocké haché ; flag OFF : section absente et ancien flux 404 |
| ADMIN distinct d'OWNER | l'ADMIN voit le formulaire serveur, crée une date, retire la date d'un autre ; le MEMBER ne voit pas « Retirer » sur la date d'un autre mais retire son propre anniversaire |
| POST forgé | rejeu de la vraie requête `createCommunityDateAction` par un MEMBER : aucune date créée (témoin positif OWNER : créée) ; rejeu de la suppression avec l'identifiant d'une date d'autrui par un MEMBER : date conservée (témoin positif ADMIN : supprimée) |
| Notifications | 0 livraison envoyée pour les sources de cette communauté (exécuteur éteint, HTTP externe bloqué) ; des livraisons restent en file (veto de roulette) et n'ont pas été traitées |

Défaut démontré et corrigé (commit séparé) : sur `/roulette/[id]` en mobile 390x844, le halo « radar » de la roue faisait défiler la page horizontalement pendant la rotation (`scrollWidth` 391 à 449 pour 390). Correctif : `overflow-x-clip` sur le conteneur de la page ; les mesures ponctuelles après correction donnaient 390 <= 390.

Limites ajoutées :
- En mode dev, StrictMode double l'effet de `RouletteResultAnimation` (garde `started`) : la roue reste sur « La roue tourne… » et le résultat animé n'apparaît pas. Probablement propre au mode dev (en production l'effet ne s'exécute qu'une fois) mais NON vérifié sur un build de production ; hors périmètre, non corrigé.
- Le même halo existe dans `RouletteWizard` (roulette instantanée) : non testé en mobile.
- Pour la roulette asynchrone, le script échantillonne maintenant `scrollWidth` toutes les 100 ms pendant 2,2 s, couvrant le cycle de la pulsation radar. La preuve précédente ne mesurait que deux instants rapprochés ; cette reprise n'a pas rejoué la recette navigateur, donc le nouvel échantillonnage reste à vérifier.
- Veto de roulette : `ROULETTE_PLAYER_FILTER_ENABLED` non testé ; l'édition d'annonce Discord n'est pas vérifiée au-delà de la mise en file.
- Rejeu forgé du veto de soirée avec le flag OFF non testé (identifiant d'action non conservé entre deux serveurs) ; seul l'état de l'interface et de la base est vérifié.
