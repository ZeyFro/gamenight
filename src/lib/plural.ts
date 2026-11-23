/**
 * Pluriel français d'un mot selon un nombre : 0 et 1 (et tout nombre de valeur absolue < 2, comme « 1,5 jour »)
 * prennent le singulier, 2 et plus le pluriel. Retourne le mot ENTIER (« soirées », « jeux »), jamais un suffixe :
 * le texte reste un seul nœud (un suffixe « s » ajouté par une expression JSX collée au mot le coupait en deux nœuds,
 * que les lecteurs d’écran et les outils de lecture de page recollent avec des espaces : « 18 soirée s jouée s »).
 */
export function plural(count: number, singular: string, pluralForm: string = `${singular}s`): string {
  return Math.abs(count) >= 2 ? pluralForm : singular;
}
