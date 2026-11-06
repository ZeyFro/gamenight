# État de reprise — 6 novembre 2026

Source de vérité : [issue #400](https://github.com/ZeyFro/gamenight/issues/400).
Les états CI sont des relevés ; relire les têtes et commentaires avant reprise.

## Dry-run Neon Test réellement réussi

#418 est fusionnée dans main, `b603dd03d398588f3a70086997f313af6e5dbbb1`.
[Run 42291255308](https://github.com/ZeyFro/gamenight/actions/runs/42291255308),
job migrate, tentative 1 : SUCCESS, après approbation standard de ZeyFro.
Le préflight Prisma natif et le runner ont vérifié le projet
`misty-tooth-45335023`, la branche `tower-migration-test-20261105`
(`br-snowy-snow-b1cggq2w`), la base `neondb`, l'endpoint direct et le rôle
`gamenight_test_migrator`, distinct du rôle applicatif, avec propriété/droits DDL.
TLS est requis par la configuration ; la version négociée n'est pas publiée.

Seulement deux migrations en attente, dans cet ordre :

1. `20261104140000_tower_team_membership_policy`, SHA-256
   `9f642e6200bef888669e9c058bf1623ad582cd2772ea5e433a7b78bfa596db8f`.
2. `20261105120000_tower_launch_channels_appeals_matchmaking`, SHA-256
   `e7782519fcdf5e9637f131fbd348ceb07c8f6f177dbe87f82ba9a18f6c94a9de`.

Le journal confirme DRY-RUN, aucune écriture. La lecture indépendante Work après
le run confirme 118 entrées Prisma, aucune inachevée et aucune entrée pour ces
deux migrations. [Preuve complète et sauvegarde](https://github.com/ZeyFro/gamenight/issues/400#issuecomment-6696087598).
La sauvegarde `backup-tower-migration-test-20261106` (`br-purple-mud-b1nt0tfi`)
est ready, enfant de la cible, no_compute, point `0/2A355C30` ; limite 10 branches.
**La restauration reste à éprouver séparément.** Ne modifier/supprimer aucune
sauvegarde ni créer une branche pour contourner la limite.

Work a configuré environnement protégé main/ZeyFro, rôle et secret. Les refus
API Cloud pour approbation/listes de secrets ne prouvent pas leur absence.
Ne pas recréer ces ressources. Aucun secret à demander dans le chat.

## PR et dépendances

- #370 `6cff66b` : réouverture d'une équipe dissoute refusée, limite de créations
  couverte, index conservé sans réécriture SQL. 23 tests locaux ; CI verte.
- #406 `23ba5a8` : correctif roulette et B14, puis fixtures VAPID P-256 et
  restauration des environnements de test T4/T5. CI générale, rules/storage et
  Preview vertes. Compatibilité stricte avec #325 à simuler sur copie jetable.
- #396 `e582df3` : trois défauts corrigés, contre-tests conservés, 51 tests
  PostgreSQL revalidés et CI verte ; PR encore Draft.
- #407 `6ec348d` : arbitre fixe configuré à l'avance, journalisé et gelé pendant
  une contestation ouverte ; cas OWNER réservé à cet arbitre, délai 24 h après
  annonce effective. 114 tests ciblés et 3 707 en suite locale, CI verte.
  Migration `20261106150000_tower_fixed_arbiter` uniquement locale, hors du
  périmètre des deux migrations autorisées à préparer.
- #408 `0e9ff59` et #416 `3f2702f` : parents intégrés, respectivement 60 et 81 tests
  ciblés, CI vertes. #416 reste empilée sur #408 ; aucun enregistrement Discord.
- #415 (préflight local), #417 (podium en lecture seule) et #413 (documentation)
  sont des lots autonomes sans migration : intégrer main, vérifier le périmètre,
  tests/typage/lint/CI et revue indépendante avant Ready. Le propriétaire a
  autorisé ce Ready ciblé ; aucune fusion automatique. SHA et résultats dans #400.
- #395 et #414 fermées sans fusion ; exclusion des comptes de test retirée,
  aucune API OpenAI payante ni activation de pilote payant.

## Ordre obligatoire et prochaine reprise

1. Préparer dans une PR Draft un workflow manuel distinct d'application de #370
   puis #406 sur Neon Test. Le runner applique tous les dossiers présents :
   stage118+370 seul, contrôle après119, ajout406 seulement ensuite et contrôle120.
   Vérifier checksums, schéma, données, rôle et TLS avant/après chaque étape.
   Aucun apply tant que revue, restauration, contrôles et accord distinct manquent.
2. #370 et #406 ne sont pas fusionnées ; aucune migration de ces PR appliquée
   à Neon Test ou Production au dernier relevé. Production option B : préparation
   seulement après validation Neon Test, autorisation Production séparée.
3. #325 appartient exclusivement à Claude Code. Le jalon officiel exige
   **#370 ET #406 fusionnées sur main ET leurs migrations appliquées en Production**.
   Alors seulement annoncer : « #370 et #406 mergées et migrées, #325 peut passer
   en phase 4 ». Après ce jalon, ne fusionner aucune autre PR contenant une
   migration tant que #325 n'a pas été migrée. Claude seul attribuera ses nouveaux
   horodatages réels ; ne pas contourner le garde chronologique ni modifier #325.
4. Recette/OAuth, Discord/Atlas/rôles/bots, catalogue/flags/activation/bêta :
   configuration autorisée, intégrations et preuves de vrais membres encore
   nécessaires. Tests locaux/Preview ne valent pas recette réelle ni ouverture.

Les répétitions SQL antérieures étaient sur PostgreSQL fictif local :118→119→120,
puis121 pour #407. Elles ne sont pas des migrations distantes. Aucun merge,
Ready hors du lot autorisé, migration distante, variable Vercel, flag ou action
Discord effectué par cette préparation. Quota réel non mesurable : cible10 %
non garantie ; poursuivre utilement sans boucle ni relance inutile.

#410 a été fusionnée historiquement dans une ancienne branche documentaire,
mais son UI n'est pas dans main. Son historique est préservé et aucun fichier UI
n'est importé par #413 ; réintégration séparée à prévoir selon plafond de PR.
