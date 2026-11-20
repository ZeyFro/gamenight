# Rivalités entre équipes et « Jouer maintenant » (Rejoindre / Intéressé)

Interrupteur : `TEAM_RIVALRIES_ENABLED` (exactement `true`, OFF par défaut). Migration additive `20261118130700_team_rivalries` (deux enums, deux tables ; après #416).

## Rivalités
- Page `/equipes/[id]/rivalites` (404 éteint), lien « Rivalités et historique » sur chaque équipe de `/equipes`.
- Le **capitaine** (`captainId ?? createdById`, membre actif) propose un défi à une autre équipe de la communauté (jeu et message facultatifs). Un seul défi ouvert par paire, 5 défis ouverts au plus par équipe. Une proposition expire après 7 jours (fermée à la lecture de la fiche).
- Le **capitaine adverse** accepte ou refuse ; le proposant ne peut jamais accepter son propre défi. Le proposant peut annuler tant qu'aucun résultat n'est déclaré.
- Un capitaine déclare le résultat d'un défi accepté (victoire, défaite, égalité) ; l'**autre** capitaine confirme (défi terminé) ou conteste (résultat rejeté, compteur de contestations, à redéclarer). Le déclarant ne peut pas confirmer son propre résultat.
- Le bilan de la fiche d'équipe ne compte que les défis terminés (résultat confirmé par les deux capitaines). Aucun XP, aucun étage, aucun classement officiel.
- Notifications in-app aux capitaines concernés ; aucun Discord.

## Jouer maintenant
- « Rejoindre » est inchangé (la présence reste la seule source des récompenses). Nouveau : « Intéressé » (signal sans présence), effacé quand la personne rejoint, notification in-app au créateur.
- Avec le flag, les **nouvelles** sessions expirent 2 h après leur création (3 h sinon) ; l'intérêt expire avec la session. Les sessions déjà créées gardent leur échéance.
- Flag éteint : aucune requête sur la table d'intérêts (la migration peut ne pas être appliquée).

## Limites
- Pas de contestation arbitrée : un désaccord se règle entre capitaines (redéclaration) ; l'arbitrage staff pourra venir ensuite.
- Pas de commande Discord ni d'annonce pour les défis (aucune écriture Discord).
