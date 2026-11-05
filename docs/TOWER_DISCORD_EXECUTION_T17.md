# T17 — Plan d'exécution Discord soumis à accord

Suivi #400. Plan uniquement ; aucune requête d'écriture ni suppression effectuée. Dépendance : #384 appartient à Claude Code. Le chiffre de 134 anciens rôles est une cible historique à revérifier, pas un inventaire actuel certifié.

## 1. Inventaire et garde de départ

Après relecture de #384, exécuter son inventaire en lecture seule avec la bonne application/guild et relever UTC, SHA, IDs des rôles, permissions et overwrites. Compléter manuellement les dépendances que le script ne connaît pas : rôles attribués aux membres, règles YAGPDB/Atlas, bots tiers, intégrations et salons privés. safeToDelete=false ne devient jamais une permission de suppression.

Conserver un relevé des noms, couleurs, position, permissions, canaux dépendants et attribution des rôles avant de proposer un changement. Une exportation n'est pas une restauration garantie des IDs Discord : un rôle recréé aura un autre ID. Aucun secret ni contenu privé dans un rapport public.

## 2. Arrêt d'Atlas et progression

T16 doit identifier précisément la fonction d'attribution d'étages d'Atlas et ses autres fonctions utiles. Préparer un arrêt de cette seule attribution ; ne pas retirer le bot ni ses fonctions sans preuve. Obtenir accord sur les paramètres exacts à changer. Vérifier ensuite qu'Atlas n'attribue plus d'étage, et que GameNight réalise un parcours réel sans double progression. Ne pas transférer les anciens niveaux au compteur neuf sans décision : les profils/historiques doivent rester conservés.

## 3. Retrait contrôlé des rôles Étage

- Tableau candidat : ID, nom, membres, dépendances, solution de remplacement, preuve de recette, décision Claude, accord Maxime.
- Un rôle avec une dépendance inconnue reste à conserver. Ne jamais utiliser seulement le nom ou un intervalle numérique comme autorisation.
- Tester le remplacement dans la recette isolée et vérifier les salons privés avec un vrai compte membre.
- Présenter une liste exacte d'IDs avant chaque lot de suppression ; obtenir confirmation à l'action, car la suppression ne se restaure pas à l'identique par le flux normal.
- Vérifier les droits après chaque lot autorisé ; conserver les historiques GameNight et messages utiles. Arrêter à toute perte d'accès ou changement privé imprévu.
- Aucun script de suppression automatique dans ce plan ; aucun retrait de rôle de prestige/staff/bot/sanction implicitement autorisé.

## 4. Ticket Tool

Identifier les panneaux et leur message source, les catégories cibles, les permissions, la fermeture et les transcripts ; distinguer assistance Ticket Tool et candidatures Appy. Réparer et tester le panneau retenu en recette. Présenter l'ID exact du panneau doublon et sa suppression/archivage proposée avant accord. Ne supprimer ni ticket actif ni historique/transcript. Une catégorie vide seule ne prouve pas un système inutile.

## 5. Forums et marqueur tournoi

Lire les salons existants avant d'en créer : l'ancien audit trouvait zéro forum, alors que le cahier envisage leur réutilisation. Ne pas affirmer qu'ils existent actuellement. Proposer par forum des tags précis jeu/plateforme/objectifs et règles d'usage ; aucune conversion de salon ou migration de messages sans plan d'historique.

Pour #tournois : identifier l'ID, le type de salon et le sens du marqueur demandé (nom, description, message/panneau). Préparer l'avant/après à l'écran puis accord, sans mention globale ni annonce automatique. Si le marqueur reste ambigu, conserver l'existant et demander seulement cette décision au moment du changement.

## 6. Validation et arrêt

Relever chaque action autorisée avec UTC, ID, avant/après et résultat membre/admin/mobile. Vérifier accès général/privé, onboarding, tickets, recrutement et absence de progression Atlas concurrente. Aucune permission administrateur dérivée d'un grade.

Les opérations se font sur The Tower uniquement après accord précis. Les suppressions irréversibles requièrent validation à l'action ; en cas d'incident, stopper le lot et préparer une correction des droits existants, sans promettre le rétablissement des IDs supprimés. Aucun bot invité, message envoyé, commande enregistrée ni salon/permission modifié par ce document.
