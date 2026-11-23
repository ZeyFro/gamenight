# Questions pour Maxime — une seule liste

> 23 novembre 2026. Tout ce qui demande **ton** choix, regroupé ici pour ne pas te solliciter au fil de l'eau. Pour chaque question, coche une case. Ma recommandation est marquée ⭐. Quand une question n'a pas de réponse, je ne fais rien sur ce sujet.

## A. Les 9 éléments reportés du cahier

Le cahier les classe « v2 », « plus tard », « option future » ou « exclu ». Les coder maintenant retarderait le lancement de plusieurs semaines.

| # | Élément | Choix |
| --- | --- | --- |
| Q1 | C095 — Internationalisation (étapes à 10 000 puis 50 000 membres) | ⭐ ☐ Après le lancement · ☐ Maintenant |
| Q2 | C096, C097, C098 — Concierge IA, IA pour les contenus, validation IA des preuves | ⭐ ☐ Exclu (le cahier dit « aucune IA » pour les preuves) · ☐ Plus tard |
| Q3 | C099, C100 — Discord Activities ; améliorations visuelles Discord (tags, bannières) | ⭐ ☐ Plus tard · ☐ Maintenant |
| Q4 | C101, C102, C103 — Bot permanent (présence en vocal en continu), rangs importés (Riot, Hypixel), VIP payant | ⭐ ☐ Exclu pour la v1 (coût d'hébergement permanent, pas de revenus) · ☐ Plus tard |

## B. Décisions de fonctionnement

| # | Question | Choix |
| --- | --- | --- |
| Q5 | **Purge automatique des anciennes données** (chat des soirées finies depuis 7 jours, soirées et tournois très anciens) | ⭐ ☐ Oui, après une semaine de simulation · ☐ Non, on garde tout (la base gratuite se remplit) |
| Q6 | **Galerie photos et vidéos des soirées** (stockage privé Vercel Blob, 8 médias de 4 Mo au plus par soirée) | ☐ Oui au lancement · ⭐ ☐ Plus tard (la quantité de stockage reste à surveiller) |
| Q7 | **Notifications sur le téléphone** (Web Push, l'appareil doit accepter) | ⭐ ☐ Oui (tu génères 3 clés VAPID, je te guide) · ☐ Non |
| Q8 | **Temps passé en vocal pendant les soirées** (consentement de chacun, effacé après 30 jours, visible par le créateur seulement) | ☐ Oui · ⭐ ☐ Non pour la v1 (données sensibles, peu utile) |
| Q9 | **Défi d'équipe quotidien à 18 h** | ⭐ ☐ Oui · ☐ Non |
| Q10 | **Nom de l'étage XP** (constat V3-11 : deux « étages » côte à côte prêtent à confusion) | ⭐ ☐ « Palier » pour l'XP, « Étage » pour la Tour · ☐ Autre nom : ____ |

## C. Hébergement et coûts ([CAPACITE.md](CAPACITE.md))

| # | Question | Choix |
| --- | --- | --- |
| Q11 | **Neon** : passer à l'offre payante « Launch » (sans minimum, environ 20 à 40 $ par mois) | ⭐ ☐ Oui avant le lancement · ☐ Non (risque : la base s'arrête vers 50 à 100 membres actifs) |
| Q12 | **Vercel** : passer à l'offre « Pro » (20 $ par mois) | ⭐ ☐ Oui avant le lancement · ☐ Non, et je plafonne à environ 100 membres actifs |
| Q13 | **Adresse de contact publique** (pages légales) | ⭐ ☐ Créer une adresse dédiée · ☐ Garder l'adresse personnelle actuelle |

## D. Discord ([PERMISSIONS_BOTS.md](PERMISSIONS_BOTS.md))

| # | Question | Choix |
| --- | --- | --- |
| Q14 | Bots en doublon : garder **un seul** bot de modération | ⭐ ☐ MEE6 · ☐ Atlas · ☐ YAGPDB · ☐ Garder les trois |
| Q15 | Discord.Me (référencement du serveur sur un annuaire) | ⭐ ☐ Retirer · ☐ Garder |
| Q16 | MEE6 et UnbelievaBoat ont leurs propres niveaux et leur propre monnaie, en doublon avec l'XP de GameNight | ⭐ ☐ Couper leurs niveaux et leur économie · ☐ Garder les deux systèmes |

## E. Notifications (règle du cahier, décision du 17-18/11)

| # | Question | Choix |
| --- | --- | --- |
| Q17 | Messages privés **seulement** pour ce qui te concerne personnellement : invitation, candidature, ton défi, contestation. Je code une garde qui bloque tout autre MP. | ⭐ ☐ Oui · ☐ Non |
| Q18 | Annonces publiques dans les salons **seulement** pour les moments marquants : création de soirée ou de tournoi, réussite de défi, podium | ⭐ ☐ Oui · ☐ Non, annoncer aussi les modifications |
| Q19 | Mentionner un **rôle de jeu** (par exemple @Valorant) seulement pour les membres qui l'ont demandé | ⭐ ☐ Oui · ☐ Jamais de mention de rôle |

## F. Ajoutées pendant le codage (23/11)

| # | Question | Choix |
| --- | --- | --- |
| Q20 | Un profil masqué doit-il aussi être caché dans les **classements** ? (Aujourd'hui : caché dans Potes, les fiches et les suggestions ; visible dans les classements et les soirées, pages partagées.) | ⭐ ☐ Non, garder la règle actuelle · ☐ Oui, afficher « Membre discret » |
| Q21 | **Créneau de migration** : les PR #525, #526 et #527 ajoutent des colonnes. Je les fusionne une par une quand tu peux approuver tout de suite le run « Migrations Production » (2 minutes chacune). | ☐ Donne-moi un jour et une heure : ____ |

---

**Réponds simplement** avec la liste des numéros et la case choisie, par exemple : « Q1 après, Q2 exclu, Q5 oui… ». Je mets ensuite à jour [CAHIER_FINAL.md](CAHIER_FINAL.md) et [ALLUMAGES.md](ALLUMAGES.md).
