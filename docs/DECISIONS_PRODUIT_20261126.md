# Décisions produit du 26 novembre 2026

Décisions de Maxime, consignées le 26/11/2026. Elles font foi pour la suite et **remplacent** les règles antérieures qui les contredisent (par exemple une ouverture à date fixe, ou la passation de capitaine après 30 jours).

**Règle de preuve, commune à toutes les décisions.** Une décision est mise en œuvre quand son code est fusionné. Elle n'est « verte » qu'après un **test réel d'un compte non-admin**, daté et consigné. Un flag allumé, une page affichée ou un test automatisé ne suffisent pas.

| N° | Décision |
| --- | --- |
| **D1** | **Ouverture** quand les **61 lignes actives** du cahier ([CAHIER_FINAL.md](CAHIER_FINAL.md)) sont vertes. Les 9 lignes « Reporté » C095 à C103 sont exclues. **Aucune date.** Preuve = test réel d'un compte non-admin. **C098 n'est jamais allumé en v1.** |
| **D2** | **`/role`** : création directe, un rôle par jeu, cosmétique. Alerte à **200 rôles sur 250**, blocage à 200 conservé. L'approbation par le staff est repoussée après les 61 lignes. Les rôles de jeu relèvent de **GameNight**, les rôles hors jeux de **YAGPDB**. |
| **D3** | **Annonces de joueurs** : créées dans GameNight, relayées en **un seul post** de forum, fermé à l'expiration. Pings de rôle en **opt-in**, plafonnés à **3 par joueur et par jour**. |
| **D4** | **Vocabulaire** : **Étage** = défis (`floorsClimbed`) ; **Grade** = étages ; **« Niveau d'XP »** = XP ; **« Niveau de jeu »** = niveau par jeu. |
| **D5** | **Dissolution d'une équipe** (par le capitaine, ou au départ du dernier membre) : suppression immédiate des 2 salons, **par identifiant enregistré uniquement**. Avec confirmation, et inscrite au journal. Bloquée si un signalement ou une contestation est ouvert. Permissions par membre, **sans rôle par équipe**. |
| **D6** | **Tournois à 5 équipes** : poule unique, 10 matchs. L'arbitre tranche **24 h après la dernière déclaration**. La règle au-delà de 6 équipes **n'est pas validée**. |
| **D7** | **Soirées** : **publique** (espaces communs) ; **sur candidature** et **privée** (espaces temporaires, supprimés à la fin, accès retirés). |
| **D8** | **Équipes** : capitaine + **2 recruteurs**, relance à **48 h**. Passation après **14 jours d'inactivité**, inscrite au journal. |
| **D9** | **Projets** : plusieurs par joueur. Uniquement des fils : la paire **annonce publique + fil privé**. **90 jours maximum.** |
| **D10** | **Notifications** : MP seulement pour ce qui vise le joueur ; pings de jeu en **opt-in** ; repli sur le centre de notifications ; plafond de **3 par jour**. |
| **D11** | **Un seul chemin d'arrivée** : YAGPDB valide le règlement, puis le panneau de #635 ; écran de première connexion dans l'application. **Pas d'onboarding natif Discord.** Le panneau n'est publié qu'**avec l'accord de Maxime**. |

## Où en est la mise en œuvre (relevé du 26/11/2026)

PR **ouvertes, non fusionnées**, sauf mention contraire. Aucune décision n'est verte en réel à cette date.

| N° | PR |
| --- | --- |
| D1 | #638 (seuil de lancement et capacité gratuite) |
| D3 | #639 (relais forum et plafond de pings) |
| D4 | #643. L'étage des défis lu depuis `floorsClimbed` sur `/tower` est déjà dans main (#630). |
| D5 | #642 (empilée sur #639) |
| D6, D8, D9 | #641 (poule unique, arbitrage à 24 h, passation journalisée, projets à 90 jours) |
| D11 | Panneau d'accueil : #635, fusionnée et non publiée. Écran de première connexion : #640. |
