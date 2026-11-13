# Revue du workflow d'application Neon Test

Préparation uniquement. Aucune exécution distante ni fusion autorisée ici.
Le dry-run #418 historique (run42291255308 sur main b603dd0) n’est plus une preuve utilisable : il précède l’alignement de l’opérateur et ses sources approuvées. Le workflow ne propose aucun ID par défaut ; un nouveau dry-run devra réussir sur `main` avec les empreintes actuelles avant toute validation distante. La sauvegarde indépendante reste documentée dans #400 commentaire6696087598.
La sauvegarde br-purple-mud-b1nt0tfi est ready au point0/2A355C30. Work a ensuite
éprouvé une **copie isolée de cette branche** : preuve
[#400, commentaire6711821666](https://github.com/ZeyFro/gamenight/issues/400#issuecomment-6711821666).
Cela ne constitue pas un exercice de restauration réelle de la branche Test (restore snapshot, Reset from parent ou PITR).
Ne pas toucher à Production ni à #325.

### Preuve de restauration encore requise

La copie isolée de branche documentée ci-dessus n’est ni un `restore_snapshot`, ni un Reset/PITR, et ne satisfait pas `RESTORATION_TEST_VALIDATED=true`. Avant toute future application, il faudra une preuve d’un exercice de restauration réellement effectué sur une destination Test isolée, après autorisation distincte, ou une nouvelle décision propriétaire et une modification revue de la politique si la portée de la copie doit être acceptée. Aucun exercice distant n’est autorisé par cette préparation.

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

Le checkout opérateur est scellé au `main` vérifié `6d6e30e76f4f96acb25c37fa6f97f08f42dca6c7` (118 migrations). Les 118 noms et SHA-256 SQL correspondent exactement à `baseline.json`; aucune migration publiée n’est modifiée. `package.json` et `package-lock.json` correspondent à ce même commit (Next.js et eslint-config-next 16.4.5).

Le runner chronologique est copié du SHA4a18b74 de #370, sans modification. Les SQL #370
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
contraintes validées, index et enums. Les manifests sont séparés explicitement
pour PostgreSQL16 et18, seuls majeurs admis, puis pour chacune des phases118,
119 et120. Aucun catalogue inconnu n'est accepté. PostgreSQL18 conserve dans
pg_constraint les NOT NULL et leur conenforced : ils restent tous dans son
empreinte, sans filtrage ni normalisation susceptible de masquer une dérive.
Les six empreintes proviennent uniquement de bases fictives locales et des SQL
immutables. **Faire valider le nouveau
mode validate sur Neon avant activation d'apply** : une différence de catalogue
ou de version doit être analysée, jamais ignorée ou corrigée par des droits plus
larges. Les données historiques sont comparées par compteurs/empreintes calculés
en SQL, sans exporter les lignes ; seules les colonnes additives sont exclues et
leurs valeurs attendues sont vérifiées séparément. Nouvelles tables vides,
backfill capitaine correct, colonnes nouvelles NULL, histoire/checksums exacts.
Les empreintes restent en mémoire du processus, pas dans un artifact métier.

## Corrections locales des blocages observés par Work

La preuve Work [6711749800](https://github.com/ZeyFro/gamenight/issues/400#issuecomment-6711749800)
constate TLS1.3 avec certificat vérifié vers l'endpoint, alors que pg_stat_ssl
du backend vaut false. Celui-ci décrit la liaison derrière le proxy, pas la
connexion TLS du client à Neon. Il reste relevé mais ne sert plus de preuve
d'authenticité de l'endpoint. L'opérateur impose à la place **sur la même URL
transmise au client SQL, au préflight et au runner/CLI épinglés**
sslmode=require et sslaccept=strict. Les paramètres inconnus, doublons,
host de substitution, certificats/identités alternatifs et accept_invalid_certs
sont refusés. Aucun autre précontrôle, rôle ou contrôle d'identité n'est retiré.

Ce choix suit le moteur natif Prisma6 réellement utilisé :
[parseur URL6.19](https://github.com/prisma/prisma-engines/blob/6.19.0/quaint/src/connector/postgres/url.rs)
(verify-full n'est pas un mode reconnu ; sslaccept omis accepte par défaut les
certificats invalides) et
[connecteur TLS6.19](https://github.com/prisma/prisma-engines/blob/6.19.0/quaint/src/connector/postgres/native/mod.rs)
(strict conserve la validation native du certificat et du nom d'hôte).
Voir aussi [sécurité Neon](https://neon.com/docs/connect/connect-securely).
Un proxy TLS fictif local a vérifié le vrai PrismaClient et le vrai CLI :
certificat de confiance avec bon hôte accepté alors que backend_ssl=false ;
certificat non fiable, mauvais hôte et serveur sans TLS tous refusés.

La reconstruction locale des 118 migrations sur PostgreSQL16/18 donne 574 contraintes NOT NULL gérées. Le relevé Neon Test en lecture seule en donne 576 au total : les deux supplémentaires sont `public.playing_with_neon.id` et `.name`, sur la table d’exemple Neon. Cette table étrangère est désormais déclarée dans `foreign-tables.json`, avec empreinte distincte PostgreSQL18 ; ses métadonnées sont contrôlées, elle n’est pas ignorée silencieusement et ses lignes ne sont pas lues. L’écart 574/576 est donc expliqué par le périmètre de comptage, non par une divergence du schéma géré. La validation complète du catalogue géré 18/118 n’a toutefois pas été exécutée sur Neon ; le nouveau mode `validate` reste nécessaire après revue et intégration. Les deux migrations distantes restent interdites sans leur accord distinct.

## Exercice de restauration à préparer séparément

Vérification documentaire du 2026-11-07, sans connexion Neon : les pages
[Instant restore](https://neon.com/docs/postgres/backup-restore/branch-restore),
[Reset from parent](https://neon.com/docs/guides/reset-from-parent),
[CLI branches](https://neon.com/docs/cli/branches),
[History window](https://neon.com/docs/postgres/backup-restore/history-window)
[Manage roles](https://neon.com/docs/manage/roles),
[Protected branches](https://neon.com/docs/guides/protected-branches)
et le [contrat OpenAPI officiel v2](https://neon.com/api_spec/release/v2.json)
ont été lus. Aucun outil Neon authentifié n'est disponible dans cette session.
L'état réel provient des preuves Work6696087598 et6711821666 ; il n'a pas été
réinterrogé depuis Cloud.

La distinction des mécanismes est essentielle :

- Le PITR avec timestamp/LSN est documenté pour des branches racines, source
  comprise. La sauvegarde connue est une branche enfant de Test : ne pas
  supposer qu'un restore horodaté depuis cette sauvegarde est supporté.
  Son parent_lsn0/2A355C30 désigne le point dans le parent, pas un LSN à
  recopier automatiquement comme source_lsn de la sauvegarde.
- Reset from parent remplace toutes les bases du seul enfant par le HEAD de
  son parent, sans préserver l'état précédent. Il ne démontre pas un PITR.
  La destination doit être jetable, non protégée, sans enfants ; vérifier aussi
  les restrictions d'opération réelles avant de poursuivre.
- Une branche sans compute conserve sa place dans le quota. Elle n'a pas
  d'endpoint PostgreSQL utilisable ; démarrer un compute sur la sauvegarde
  n'est pas nécessaire pour créer son enfant et n'est pas autorisé ici.
  La CLI crée un compute par défaut et publie des credentials par défaut :
  tout futur usage doit choisir explicitement compute et sortie sans secrets.
  L'API ne crée aucun compute si endpoints est omis.
- Le PITR peut créer une branche de secours et interrompre les connexions.
  Le reset interrompt les connexions de sa destination. Aucun de ces appels
  ne doit viser la sauvegarde, Test ou Production pendant cet exercice.
  La fenêtre historique est une propriété du projet à relever, sans la changer ;
  elle ne garantit pas à elle seule qu'un point historique reste restaurable.

**Preuve opérateur acquise : copie isolée, pas reset/PITR.** Work a reçu un accord
distinct pour remplacer l'ancien Preview par tower-restore-rehearsal-20261107,
ID br-fancy-art-b1eqwipa, enfant de la sauvegarde au point0/2A355C30.
Sa preuve rapporte118 migrations, aucune inachevée ni370/406, schéma/historique
équivalents et agrégats identiques sur les cinq tables contrôlées. Les autres
tables métier ne sont pas couvertes par ces agrégats. Le migrateur est absent
de la copie et les cinq tables appartiennent à neondb_owner : ne pas supposer
que le secret migrateur actuel peut l'ouvrir. La sauvegarde d'origine et le
snapshot Production sont conservés. Le projet reste à dix branches.
Cloud n'a créé ni supprimé de ressource. Aucun nouvel accord de suppression,
de création, de compute ou de facturation ne découle de ce document.

Protocole alternatif Reset from parent conservé pour référence,
**non exécuté, à autoriser séparément si nécessaire** :

1. Relever en lecture seule projet, IDs, filiation, état ready, absence de compute
   et de changement sur la sauvegarde, point parent0/2A355C30, fenêtre historique,
   quotas et restrictions. Vérifier l'origine des données : aucune donnée
   Production ne doit servir à l'exercice. Conserver ces métadonnées expurgées.
2. Faire confirmer explicitement une destination isolée admissible.
   Vérifier son ID, son parent br-purple-mud-b1nt0tfi, son absence d'enfants et
   de protection, et son compute propre avant toute SQL. La source du reset
   serait le HEAD inchangé de la sauvegarde, jamais le HEAD actuel de Test.
   Aucune nouvelle branche/compute n'est autorisée par ce document.
3. Faire vérifier par l'opérateur un plan d'accès propre à cet enfant, **avant
   et après reset**, sans secret Production ni réemploi supposé de credentials
   historiques. Manage roles documente la copie des rôles existants au point de
   branchement. Protected branches précise que, lors d'une création depuis un
   parent non protégé, les mots de passe sont normalement identiques à ceux du
   parent ; depuis un parent protégé, ils sont régénérés. Lors d'un reset depuis
   un parent protégé, les mots de passe des rôles correspondants de l'enfant
   sont préservés. Cela ne garantit ni la survie d'un rôle spécifique créé
   seulement dans l'enfant, ni ses ACL, ni les credentials du cas présent.
   La documentation consultée ne tranche pas ce cycle complet pour notre
   sauvegarde et sa protection effective non relevée : faire vérifier le
   mécanisme opérateur et le résultat réel, sans inventer de persistance ou de
   disparition du migrateur. Aucune création de rôle, rotation de mot de passe,
   copie du secret migrateur ou changement de protection n'est autorisé ici.
   Sans plan d'accès clone vérifié aux deux étapes, rester bloqué avant SQL.
   Après autorisation distincte de lectures et d'une sentinelle fictive sur le
   seul enfant, relever118 historiques, checksums, absence des deux migrations
   et d'inachevées, schéma, contraintes et agrégats ; créer la sentinelle dédiée
   sans données métier. Relever séparément rôles/ACL effectivement présents.
4. Après accord portant sur l'ID enfant exact, demander Reset from parent sur
   cet enfant uniquement. Le contrat officiel est POST
   /projects/{project_id}/branches/{child_id}/restore avec uniquement
   source_branch_id=br-purple-mud-b1nt0tfi ; aucun source_lsn,
   source_timestamp ni preserve_under_name. Il s'agit du mécanisme documenté
   de reset HEAD depuis le parent, pas d'un appel PITR supposé.
5. Attendre la fin réussie de toutes les opérations, relever durée et identité
   finale, reconnecter uniquement au compute de l'enfant puis vérifier disparition
   de la sentinelle et égalité des preuves118/schéma/contraintes/agrégats.
   Vérifier les rôles/ACL et l'accès selon le plan opérateur approuvé ; aucune
   absence ou persistance du migrateur n'est présumée.
   Recontrôler les métadonnées sauvegarde/Test sans activer leur compute.
   Si Neon demande une capacité supplémentaire ou propose de toucher un autre
   ID, arrêter ; le coût/quota transitoire ne peut être garanti par la doc seule.
6. Publier les seules preuves expurgées après succès réel et conserver la
   destination pour revue, sans suppression autorisée.
   Le propriétaire doit décider si cette preuve de restauration du HEAD de la
   sauvegarde satisfait son exigence. Ne pas attester PITR validé : un PITR
   véritable exigerait un protocole distinct, des branches racines adaptées,
   un point encore retenu et sa propre autorisation.

Ce protocole de reset est préparé, **non exécuté**. Les lectures et la création
de copie rapportées plus haut ont été réalisées par Work avec son accord
distinct, pas par Cloud. Aucune attestation de reset/PITR ne peut en découler ;
le propriétaire doit valider explicitement la portée de la preuve de copie.

Après erreur : arrêter, conserver diagnostics expurgés et état Prisma, ne pas
relancer ni appliquer406 si370/postcontrôle échoue. Une restauration nécessite
son propre accord ; aucun rollback SQL automatique. Le jalon #325 exige les
fusions370/406 ET leurs migrations Production, pas ce workflow de test.

## Répétition reproductible, locale seulement

Préparer une base FICTIVE jetable déjà au baseline118, nommée
`gamenight_apply_rehearsal_<suffixe>`, à 127.0.0.1. Ne jamais utiliser de copie de
données Production. Les objets Git 6d6e30e,4a18b74,1a495ede doivent être présents.
Depuis le checkout de cette préparation, avec dépendances Node22 installées :

```sh
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_apply_rehearsal_proof node scripts/neon-test/rehearse-local.mjs
```

Pour reproduire la vérification du vrai TLS client/CLI sans aucune écriture SQL,
sur la même base locale fictive et avec openssl installé :

```sh
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_apply_rehearsal_proof node scripts/neon-test/rehearse-native-tls.mjs
```

Ce second outil génère des certificats fictifs éphémères, ouvre uniquement des
ports127.0.0.1 et ne transmet leur CA qu'aux processus de test. Il ne modifie
ni le magasin de confiance de l'opérateur ni son environnement parent.

`rehearse-local.mjs` refuse tout autre hôte/nom, toute redirection et toute identité Neon.
Cet outil de répétition des migrations applique réellement les deux SQL **sur cette seule base fictive**, via le
runner épinglé : dry-run/exécution370, contrôle119, dry-run/exécution406,
contrôle120, mêmes empreintes de schéma et données conservées. Le rôle local
est propriétaire, sans comparaison runtime du runner (avertissement local) ;
la séparation réelle est contrôlée sur Neon par le préflight et le premier
mode validate. Aucun privilège supplémentaire n'est accordé par l'outil.
Les manifests contiennent seulement noms/checksums SQL et empreintes de schéma,
aucune ligne métier ni empreinte de données réelle persistée.
# Diagnostic d'un refus d'historique — 13 novembre 2026

Le dry-run `43320658340` est réussi sur main `50e8246`. La validation renforcée
`43388116969` a ensuite refusé l'historique avec
`NEON_TEST_HISTORY_MISMATCH`, après préflight identité/rôles/DDL réussi et avant
tout appel d'application. Les 118 empreintes attendues correspondent aux SQL
du dépôt ; le journal initial ne précise pas la ligne distante divergente.
Cela ne prouve pas encore un checksum erroné : doublon, nom inattendu, statut
inachevé ou rollback peuvent aussi produire ce refus. Aucun SQL ni historique
distant n'a été modifié pour ce diagnostic.

Le contrôle renforcé peut désormais émettre `NEON_TEST_HISTORY_DIAGNOSTICS`
avant de relancer **la même erreur bloquante**. Le rapport est limité à huit
détails, avec compte attendu/réel et indicateur de troncature. Seuls les noms
de migrations approuvés et les empreintes de 64 caractères hexadécimaux sont
affichés ; les noms inattendus et valeurs malformées sont remplacés par des
marqueurs fixes. Aucune ligne métier, URL de connexion, valeur de secret ou
horodatage brut n'est journalisé. Même une erreur du logger ne permet pas de
poursuivre la séquence.

Après revue/fusion manuelle de ce seul correctif de diagnostic, relancer le
workflow en **operation=validate**, avec la preuve dry-run toujours valide
(moins de 24 h et sources approuvées inchangées), puis faire approuver
l'environnement protégé. Si la preuve a expiré, renouveler d'abord le dry-run.
Ne jamais utiliser `apply` pour diagnostiquer. Le prochain refus doit permettre
d'identifier la migration et le type d'écart sans les accepter automatiquement.

Comparer ensuite les seuls SQL et métadonnées historiques nécessaires, avec
le rôle dédié et une transaction de lecture seule sur la branche de test.
Une différence de fins de ligne est une hypothèse à prouver, pas une raison
d'ignorer les checksums. Ne pas réécrire `_prisma_migrations`, recalculer la
baseline depuis la base, lancer `resolve`/`reset`, modifier les SQL immuables ou
réduire les contrôles pour obtenir un résultat vert.
