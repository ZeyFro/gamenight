# The Tower 2.0 — décisions §26 (approuvées par le propriétaire le 17/11/2026)

> Décisions datées du 17/11/2026. Elles complètent `docs/CAHIER_DES_CHARGES.md` (§26) et prévalent sur `docs/TOWER_DECISIONS_26_20261104.md` en cas de contradiction (les écarts de code constatés sont suivis dans `docs/COUVERTURE_CAHIER.md`). Document d'alignement : aucune règle n'est déployée par cette PR.

- **Barème** : facile +1, moyen +2, difficile +3 étages. Étages permanents.
- **Grades** : Régulars dès l'inscription ; Irregular = attribution manuelle staff (prestige, aucun droit) ; Ranker ≥ 30 étages ; High Ranker ≥ 100 étages + au moins 5 défis validés sur la saison en cours. Aucun grade ne donne de droit de modération.
- **Couleurs** : Régulars gris, Irregular violet, Ranker or, High Ranker rouge.
- **Équipes** : 2 à 8 joueurs, 1 seule équipe principale par joueur et par communauté, délai de 7 jours avant de rejoindre une autre équipe, création libre pour tout membre GameNight actif, le créateur est capitaine.
- **Défis solo** : 1 attribution max toutes les 12 h, 48 h pour réaliser, max 2 réussites validées par jour (solo + équipe). **Défi d'équipe** : 1 par jour, attribution à 18:00 Europe/Paris.
- **Votes** : 24 h, min 3 votants distincts, majorité stricte, pas de vote sur sa propre preuve, égalité = non validé. Sans quorum à 24 h : prolongation unique de 24 h, puis rejet sans pénalité (le joueur peut resoumettre une fois).
- **Contestation** : ouverte 48 h après la décision, tranchée par l'arbitre fixe (#407), 1 contestation par défi.
- **Saisons** : S1 du 1er décembre 2026 au 31 mars 2027 ; puis avril–juin, saison été juillet–août, septembre–novembre.
  - Mise en œuvre (`src/lib/tower-challenge-seasons.ts`) : S1 = [1er déc. 00:00, 1er avr. 00:00[ Europe/Paris, S2 = [1er avr., 1er juil.[, Été = [1er juil., 1er sept.[, S3 = [1er sept., 1er déc.[ ; chaque année, S1 recommence le 1er décembre. Fins EXCLUSIVES, minuit de Paris avec changement d'heure.
  - Noms : `S1 · 2026-2027` (S1 est à cheval sur deux années), `S2 · 2027`, `Été · 2027`, `S3 · 2027`, puis `S1 · 2027-2028`.
  - Les quatre périodes couvrent toute l'année : aucune intersaison (ancien code : S1 du 4 janvier au 28 mars, S4 septembre–décembre, intersaisons 1–3 janvier et 29–31 mars). `active` vaut toujours `true`. Le calendrier s'applique aussi avant le lancement (le 30 novembre 2026 est dans S3 · 2026).
- **Départage des classements** : 1) étages, 2) nombre de défis difficiles, 3) date d'atteinte la plus ancienne.
- **Récompenses** : uniquement cosmétiques (titres, badges, cadres, distinctions saisonnières), durée = saison suivante. Aucune récompense payante ni administrative.
- **Onboarding** : Discord d'abord, GameNight seulement pour équipes/progression/inscriptions (cahier §4).
- **Lancement public** : semaine du 1er décembre 2026. Extensions facultatives (IA d'orientation, salons vocaux temporaires) : hors périmètre v1.
