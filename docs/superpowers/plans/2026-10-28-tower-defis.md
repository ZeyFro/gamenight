# Défis The Tower — suivi de réalisation

Objectif : intégrer les défis à l’application GameNight existante sans recréer les équipes ni doubler leur progression. Cette branche reste une PR en brouillon ; aucune migration, activation Discord ou publication Production.

## Réalisé dans la PR #336

- [x] Attribution solo au plus toutes les 12 h ; délai de preuve de 48 h.
- [x] Plafond de deux récompenses par journée Europe/Paris et verrous transactionnels contre les gains doublés.
- [x] Dépôt de preuve avec consentement explicite, vote communautaire à quorum/majorité et échéance de 24 h.
- [x] Progression, classement trimestriel, vote de saison et catalogue de départ de 12 défis.
- [x] Isolation par communauté, contrôles d’appartenance et interactions Discord signées.
- [x] Réutilisation de la file d’annonces existante ; les flags restent éteints par défaut.

## Vérifications sur la tête contrôlée `134c9d6c7c4f19eb15998110706677684315c59d`

- CI générale réussie : [run 40783545590](https://github.com/ZeyFro/gamenight/actions/runs/40783545590), avec `test:postgres`, `npm test`, génération Prisma/Next, TypeScript, lint et build terminés avec succès.
- Workflows Tower réussis : [run 40783545592](https://github.com/ZeyFro/gamenight/actions/runs/40783545592), tests des règles, vote, interactions et stockage PostgreSQL réussis.
- Déploiement de la branche READY : [Vercel `dpl_4t4EY6NoRaf9AaRk4Tn6gcVopDej`](https://vercel.com/mpmaximeparisot-6230s-projects/gamenight/4t4EY6NoRaf9AaRk4Tn6gcVopDej). Le retour OAuth de Preview n’a pas été vérifié.

Ces contrôles ne signifient pas que les commandes sont installées sur le Discord réel ni que les migrations ont été appliquées. Aucun test n’a écrit dans Neon/Production.

## Restant avant un lancement complet

- [ ] Réconcilier les défis d’équipe et le quota commun avec la progression existante de la PR #329, sans la fusionner ni compter deux fois l’ascension. Cela nécessite d’examiner les deux modèles ensemble.
- [ ] Vérifier le retour OAuth Preview sans changer l’authentification de Production.
- [ ] Faire relire puis maintenir la PR en brouillon jusqu’à la validation et à la fusion par le propriétaire.
- [ ] Après approbations distinctes : organiser l’application des migrations, l’enregistrement des commandes et l’activation des flags ; aucune de ces actions n’est effectuée ici.
- [ ] Intégration visuelle au site non incluse et à arbitrer avant lancement.

## Hypothèses et limites

- Les saisons suivent des bornes trimestrielles scolaires métropolitaines standard à Paris ; le calendrier exact d’un lycée peut différer.
- La saison vote s’ouvre au premier accès après sa clôture et reste ouverte 48 h ; aucun rôle Discord ni étage bonus n’est attribué au vainqueur.
- Claude configure Discord. Codex ne modifie ni salons, rôles, permissions, tickets ou réglages de bots.
- #325 et #329 restent séparées. Aucun secret, aucune notification réelle, aucun faux événement et aucune configuration Production ne sont nécessaires aux validations ci-dessus.
