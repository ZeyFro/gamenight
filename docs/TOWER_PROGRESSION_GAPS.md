# The Tower 2.0 — progression : état et périmètre

Analyse ciblée de `origin/main` (`5bed623`) et de la roadmap, le 26 octobre 2026. Cette note ne change aucun barème ni acquis.

## Déjà présent

- XP communautaire comptabilisée par événement dans `XpEvent`; niveaux, titres et rangs calculés par formules partagées. Les sources comprennent soirées créées, votes, participation, disponibilité, liaison Steam, résultats, défis, pronostics et tournois.
- Garde anti-farm explicite : au plus trois gains de création de soirée sur 24 h; unicité des événements XP et attribution transactionnelle. Le bonus de régularité est plafonné à +50 %. Aucun gain n’est attaché aux invitations brutes ou à l’envoi de messages.
- Badges individuels et trophées collectifs, progression saisonnière mensuelle avec snapshots, classements, défis hebdomadaires, boutique de titres/cadres/couleurs et historique des gains.
- Plusieurs surfaces existent déjà : Home, profil, `/classement`, `/saisons`, `/profil/lore`; `docs/ROADMAP.md` signale les lots L5-03/L5-05 et leurs compléments livrés.
- Les fonctions récentes sont isolées par communauté; la remise à zéro saisonnière est transactionnelle et conserve le podium dans `SeasonSnapshot`. Les badges déjà gagnés ne sont pas retirés après modification de critères.

## Lacunes pour une « ascension » lisible

- Le modèle d’XP reste celui de GameNight : aucun étage n’est une entité métier dédiée, et les niveaux/rangs ne décrivent pas encore une ascension Tower compréhensible.
- Pas de catalogue explicite d’épreuves, de parcours par palier, ni d’écran réunissant objectif courant, prochain palier et récompenses. Les défis hebdomadaires couvrent deux objectifs automatisés seulement.
- Il n’existe pas de lien vérifié entre niveaux/étages de l’application et les 134 anciens rôles Discord `Etage 1–134`. L’audit Discord exporte les rôles et leurs permissions, mais pas les membres ni leurs attributions : impossible de reconstituer qui détient quel étage, ou d’affirmer qu’un rôle est inutilisé.
- Les saisies d’absence et bonus de présence sont déclaratives (L5-04); elles ne constituent pas une mesure d’activité Discord ou vocale. Ne pas ajouter de récompenses sur messages, invitations, présence forcée ou collecte vocale implicite.

## Premier périmètre conseillé

Présenter l’ascension comme une couche dérivée des niveaux XP existants : afficher étage, niveau, progression vers le prochain palier, rang et activités éligibles dans une même vue. Définir les étages à partir de plages de niveaux sans réinitialiser l’XP, modifier les événements déjà comptés ni créer une seconde monnaie. Les récompenses initiales restent cosmétiques et utilisent les badges/boutique existants; les défis s’appuient sur les soirées terminées et les objectifs déjà attestables.

### Incrément livré dans cette branche

La page `/ascension` lit `CommunityMemberStats` pour la communauté active, sans repli sur le champ historique `User.xpTotal` ni enregistrement d’activité. Le réglage administrateur `towerLevelsPerFloor` accepte 5 à 20 niveaux par étage, avec 10 par défaut pour conserver le comportement actuel. Le pourcentage est calculé entre les seuils XP du premier niveau de l’étage et du premier niveau suivant; il n’accorde ni ne retire d’XP. La page renvoie vers les badges, le défi affiché sur l’accueil, les saisons et le classement. La migration est additive; aucun gain automatique, message Discord ou attribution de rôle n’est ajouté.

Garder les 134 rôles `Etage` en place et leurs attributions intactes. Avant toute synchronisation future, établir séparément une table de correspondance fondée sur les attributions Discord réelles et un plan de retour arrière; l’audit de structure seul ne suffit pas. Toute attribution automatique de rôle devrait être désactivée par défaut et ne jamais retirer de rôle historique lors du premier passage.

## Tests et garde-fous

- Tests unitaires des seuils niveau/étage, du prochain palier, des limites et des transitions exactes.
- Tests PostgreSQL d’idempotence XP, du plafond de création, du cloisonnement communautaire, du snapshot/rotation de saison et de la conservation des badges et cosmétiques.
- Tests de sécurité : membre actif requis, aucune fuite de données intercommunautaires, corrections admin auditées, aucune notification Discord ni attribution de rôle lors du calcul d’un étage.
- Toute migration éventuelle doit être additive et conserver `XpEvent`, `SeasonSnapshot`, attributions de badges, inventaire cosmétique et XP existante. Pas de reset ni de backfill de récompense sans simulation et rapprochement des résultats.

## Risque qui reste à lever

L’inventaire disponible n’inclut ni les attributions des rôles `Etage`, ni les permissions effectives par membre. Une migration de ces rôles ou la suppression de doublons ne peut pas être validée avec ce seul rapport. Ne pas la lancer avant une extraction ciblée, autorisée et privée des attributions, puis une comparaison réversible.
