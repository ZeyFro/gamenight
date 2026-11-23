/**
 * Langue des actualités de jeux (card « Actu gaming » de l'accueil) : l'API publique Steam `GetNewsForApp` ne propose
 * aucun filtre de langue et renvoie ce que chaque éditeur publie (anglais, russe, chinois…). Détection simple et sans
 * dépendance, sur le titre : l'actualité n'est affichée que si elle a l'air française ; en cas de doute elle est masquée.
 */
const FRENCH = new Set([
  "le", "la", "les", "l", "un", "une", "des", "du", "de", "d", "et", "en", "au", "aux", "pour", "avec", "sans", "sur", "sous", "dans",
  "par", "ce", "cet", "cette", "ces", "qui", "que", "dont", "où", "est", "sont", "être", "ont", "très", "tout", "tous", "toutes",
  "nouveau", "nouvelle", "nouveaux", "nouvelles", "nouveauté", "nouveautés", "mise", "jour", "saison", "événement", "évènement",
  "disponible", "disponibles", "gratuit", "gratuite", "gratuits", "découvrez", "rejoignez", "annonce", "bientôt", "prochain", "prochaine",
  "équipe", "équipes", "jeu", "jeux", "correctif", "extension", "sortie", "arrive", "arrivée", "notre", "votre", "vos", "nos",
]);
const ENGLISH = new Set([
  "the", "and", "of", "to", "in", "for", "with", "on", "is", "are", "new", "update", "updates", "patch", "notes", "now", "available",
  "your", "our", "you", "we", "from", "this", "that", "out", "live", "sale", "free", "week", "weekend", "announcing", "introducing",
  "season", "event", "hotfix", "release", "coming", "soon", "will", "has", "have", "be", "at", "by", "as", "it", "its", "how", "what",
]);
// Mots d'autres langues latines qui partagent « de », « la » ou « en » avec le français.
const OTHER_LATIN = new Set([
  "el", "los", "las", "del", "con", "para", "por", "una", "uno", "und", "der", "die", "das", "mit", "für", "ist", "nicht", "il", "che",
  "di", "gli", "per", "nuevos", "nuevas", "nuevo", "nueva", "actualización", "temporada", "más", "aggiornamento", "nuovo", "nuova", "stagione", "atualização", "nova", "novo", "novidades", "temporada", "uma", "não", "em", "os", "do", "dos", "da", "das", "som", "och", "het", "een", "van", "voor", "yeni", "güncelleme",
]);
const FRENCH_DIACRITICS = /[àâçèêëîïôùûüÿœ]/i;
// Une lettre hors alphabet latin (cyrillique, chinois, arabe…) : jamais affichée.
const NON_LATIN_LETTER = /(?![\p{Script=Latin}])\p{L}/u;

function words(title: string): string[] {
  return title.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
}

/** Vrai si le titre est vraisemblablement en français. Sert uniquement à masquer les actualités d'une autre langue. */
export function isFrenchNewsTitle(title: string): boolean {
  if (!title || NON_LATIN_LETTER.test(title)) return false;
  const tokens = words(title);
  const count = (set: ReadonlySet<string>) => tokens.filter(token => set.has(token)).length;
  const other = count(OTHER_LATIN);
  const english = count(ENGLISH);
  const french = count(FRENCH) + (FRENCH_DIACRITICS.test(title) && other === 0 ? 1 : 0);
  // Un mot d'une autre langue latine pèse double : il est plus discriminant que « de » ou « la ».
  return french > english + 2 * other;
}
