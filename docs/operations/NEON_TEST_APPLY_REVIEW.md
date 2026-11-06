# Revue du workflow d'application Neon Test

Préparation uniquement. Aucune exécution distante ni fusion autorisée ici.
Le dry-run #418 a réellement réussi : run42291255308 sur main b603dd0 ; preuve
et sauvegarde indépendante revérifiée dans #400 commentaire6696087598.
La sauvegarde br-purple-mud-b1nt0tfi est ready au point0/2A355C30 ; **la
restauration n'a pas été éprouvée**. Ne pas toucher à Production ni à #325.

## Fermeture par défaut

Le workflow séparé neon-test-apply.yml est manuel, main uniquement, sous
neon-migration-test et son approbation ZeyFro. Il partage la concurrence du
dry-run, sans annulation en cours. Le mode par défaut validate ne fait aucun
execute. Une PR fusionnée ne déclenche rien automatiquement.

Apply exige trois actes explicites après revue/accord distinct du propriétaire :

- variable GitHub d'environnement NEON_TEST_APPLY_AUTHORIZATION valant
  `370-406-test-only` (non configurée par cette préparation) ;
- confirmation d'entrée `APPLY-370-406-ON-TEST` ;
- URL d'un commentaire de ZeyFro dans #400, de moins de24h, contenant les preuves
  de restauration/sauvegarde et l'accord, avec ces lignes exactes, affirmatives et uniques :

```text
RESTORATION_TEST_VALIDATED=true
BACKUP_READY=true
APPLY_TEST_370_406_APPROVED=true
BACKUP_BRANCH=br-purple-mud-b1nt0tfi
TARGET_BRANCH=br-snowy-snow-b1cggq2w
```

Ces marqueurs sont une attestation opérateur à relire, pas une preuve automatique
qu'une restauration a eu lieu. Ne jamais les publier pour débloquer artificiellement
le workflow. Le run dry-run doit avoir réussi depuis moins de24h, sur main,
avec le contenu exact du workflow, du préflight, du schéma et des manifests
package/lock approuvés. Le préflight opérateur reste celui du baseline scellé,
jamais une copie mutable du main futur. Un nouveau run récent du même
workflow est possible sans changer ses contrôles ; une CI applicative ne suffit pas.

## Ordre et validations

Le checkout opérateur est scellé à b603dd0 (118 migrations). Le runner
chronologique est copié du SHA4a18b74 de #370, sans modification. Les SQL #370
et #406 gardent leurs SHA-256 du dry-run. Aucun fichier de migration n'est ajouté
à cette PR. Toute histoire ou fichier supplémentaire, checksum divergent,
migration inachevée/annulée/dupliquée, cible/branche/rôle/TLS incorrect refuse
l'opération avant l'écriture. Aucun allow-shared-role/local, resolve, reset ou retry.

1. Arbre118+370 seulement : contrôles identité native/TLS réel, rôle dédié,
   ownership/DDL, schéma, données et quatre privilèges DML runtime séparément.
2. Dry-run370 ; nouveaux contrôles, puis execute370 seulement en mode apply.
3. Contrôle119 complet. La moindre erreur interdit même l'ajout du fichier406.
4. Ajouter406 depuis son commit épinglé, dry-run406, nouveaux contrôles119,
   puis execute406 et contrôle120.

Les empreintes de schéma public couvrent colonnes/defaults/nullabilité,
contraintes validées, index et enums. Elles ont été générées sur PostgreSQL16
fictif à partir de118 puis des deux SQL immuables. **Faire valider le nouveau
mode validate sur Neon avant activation d'apply** : une différence de catalogue
ou de version doit être analysée, jamais ignorée ou corrigée par des droits plus
larges. Les données historiques sont comparées par compteurs/empreintes calculés
en SQL, sans exporter les lignes ; seules les colonnes additives sont exclues et
leurs valeurs attendues sont vérifiées séparément. Nouvelles tables vides,
backfill capitaine correct, colonnes nouvelles NULL, histoire/checksums exacts.
Les empreintes restent en mémoire du processus, pas dans un artifact métier.

## Exercice de restauration à préparer séparément

Avant accord d'application : faire vérifier dans Neon la sauvegarde exacte,
filiation, LSN et rétention ; conserver intacte la sauvegarde. Dix branches sont
occupées : ne pas créer/supprimer de branche ou activer un compute sans accord.
Faire confirmer par l'opérateur une destination isolée et un mécanisme supporté
sans toucher à Production. Aucun appel restore supposé ni restauration en place
automatique. Si une opération sensible est nécessaire, demander son accord
précis avant exécution. Documenter source/destination/point, durée, historique,
contraintes et agrégats après restauration réelle.

La sauvegarde précède la création du rôle dédié : examiner aussi la restauration
des rôles/ACL et l'effet sur la connexion sécurisée avant toute opération.
Ne pas recréer le rôle/secret ou élargir ses droits comme contournement.

Après erreur : arrêter, conserver diagnostics expurgés et état Prisma, ne pas
relancer ni appliquer406 si370/postcontrôle échoue. Une restauration nécessite
son propre accord ; aucun rollback SQL automatique. Le jalon #325 exige les
fusions370/406 ET leurs migrations Production, pas ce workflow de test.

## Répétition reproductible, locale seulement

Préparer une base FICTIVE jetable déjà au baseline118, nommée
`gamenight_apply_rehearsal_<suffixe>`, à 127.0.0.1. Ne jamais utiliser de copie de
données Production. Les objets Git b603dd0,4a18b74,1a495ede doivent être présents.
Depuis le checkout de cette préparation, avec dépendances Node22 installées :

```sh
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_apply_rehearsal_proof node scripts/neon-test/rehearse-local.mjs
```

Cet outil refuse tout autre hôte/nom, toute redirection et toute identité Neon.
Il applique réellement les deux SQL **sur cette seule base fictive**, via le
runner épinglé : dry-run/exécution370, contrôle119, dry-run/exécution406,
contrôle120, mêmes empreintes de schéma et données conservées. Le rôle local
est propriétaire, sans comparaison runtime du runner (avertissement local) ;
la séparation réelle est contrôlée sur Neon par le préflight et le premier
mode validate. Aucun privilège supplémentaire n'est accordé par l'outil.
Les manifests contiennent seulement noms/checksums SQL et empreintes de schéma,
aucune ligne métier ni empreinte de données réelle persistée.
