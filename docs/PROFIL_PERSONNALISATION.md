# Personnalisation du profil

Interrupteur : `PROFILE_CUSTOMIZATION_ENABLED` (OFF par défaut, actif seulement si la valeur vaut exactement `true`).
Migration additive : `20261118131300_profile_customization` (enum `ProfileEntitlementSource`, tables `ProfileEntitlement`,
`ProfileCustomization`, `UserProfileEffectsPreference`). Sans la migration, activer le flag casse la page : appliquer la migration d'abord.

## Principe

Données de présentation uniquement : aucun élément ne donne d'étage, d'XP, de priorité, de vote renforcé ni de droit.
Le catalogue (`src/lib/profile-cosmetics.ts`) est du code : un membre ne saisit jamais de CSS, de couleur ni d'URL, il choisit
des identifiants. Les styles sont des classes `pc-<id>` définies dans `src/app/profile-cosmetics.css`.

## Éléments

Couleurs et dégradés du pseudo, thèmes de carte, cadres animés, bannières animées (dégradés CSS, pas d'URL), effets
(brillance, flammes, particules), titre sous le pseudo, vitrine de 3 à 6 badges débloqués, effets d'entrée.

## Obtention

| Mode | Source | Achetable |
|---|---|---|
| SHOP | boutique XP existante (`buyShopItem` débite `xpBalance`, jamais `xpTotal`) ; ligne `CommunityMemberCosmetic` | oui |
| EARNED | règle sur étages, grade, saisons terminées, tournois remportés, défis validés ; ligne `ProfileEntitlement` (source EARNED), jamais retirée | non |
| BOOSTER | drapeau d'éligibilité `booster-support` (`ProfileEntitlement`, source BOOSTER) ; exclusifs affichés tant que le drapeau est actif | non |

- `syncEarnedEntitlements(userId, communityId)` est idempotent ; il est appelé à l'ouverture de `/profil/personnalisation` et
  exposé pour les événements (fin de saison, victoire de tournoi, validation de défi).
- `grantProfileEntitlement` / `revokeProfileEntitlement` : attribution staff (source GRANT) et drapeau booster (source BOOSTER).
  La source `PREMIUM` est réservée à un futur VIP : aucun paiement n'est implémenté, elle est refusée.
- Irregular : attribution manuelle du staff ; l'élément `name-violet` s'attribue avec `grantProfileEntitlement` (source GRANT),
  jamais déduit des étages.

## Vie privée et visibilité

`loadProfilePresentation(viewerId, ownerId)` appelle `canViewPote` (communauté, `PROFILE_VISIBILITY_ENABLED`) AVANT toute lecture
des données du propriétaire. Profil masqué ou hors communauté : `null`, rien ne fuit. La vitrine n'affiche que des badges réellement
débloqués (contrôlé à l'écriture et à la lecture).

## Accessibilité et performance

- Spectateur : préférence `UserProfileEffectsPreference` (sans ligne = effets activés) et `prefers-reduced-motion` coupent toutes
  les animations et masquent les couches décoratives ; couleurs et dégradés statiques restent.
- Contraste vérifié par test (≥ 4,5:1 sur les fonds de l'app, texte clair sur chaque thème de carte).
- Le pseudo reste un texte réel ; cadres, bannières et couches sont `aria-hidden` ; titre et badges de la vitrine sont du texte.
- CSS seul (`transform`, `opacity`, `background-position`), aucun JS ni dépendance. `forced-colors` revient aux couleurs système.

## Plus tard (non implémenté)

VIP payant = cosmétique et confort uniquement, jamais étages, XP, priorité, vote renforcé ni badges gagnés. Prérequis : statut,
CGV/mentions légales, prestataire de paiement, TVA, rétractation, politique mineurs.
