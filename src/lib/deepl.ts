const DEEPL_FREE_ENDPOINT = "https://api-free.deepl.com/v2/translate";

interface DeeplResponse {
  translations: { text: string }[];
}

/**
 * Traduit un texte en français via l'API DeepL (plan gratuit —
 * api-free.deepl.com). Dégrade toujours proprement en renvoyant `null` :
 * `DEEPL_API_KEY` absente, texte vide, erreur réseau ou API — jamais
 * d'exception qui remonterait jusqu'à la fiche jeu. À charge de
 * l'appelant d'afficher le texte original dans ce cas.
 */
export async function translateToFrench(text: string): Promise<string | null> {
  const apiKey = process.env.DEEPL_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[deepl] DEEPL_API_KEY non configurée — pas de traduction.");
    return null;
  }
  if (!text.trim()) return null;

  // Cause n°1 des échecs DeepL en prod : DeepL sépare strictement les
  // deux plans par endpoint — une clé Free (qui se termine toujours par
  // `:fx`) n'est valide QUE sur api-free.deepl.com (celui qu'on appelle
  // ici) ; une clé Pro n'est valide QUE sur api.deepl.com. Utiliser la
  // mauvaise combinaison renvoie 403 sans autre indice. On log un
  // avertissement explicite plutôt que de laisser deviner via un 403 nu.
  if (!apiKey.endsWith(":fx")) {
    console.warn(
      "[deepl] DEEPL_API_KEY ne se termine pas par ':fx' (format attendu d'une clé plan Free). " +
        "On appelle quand même api-free.deepl.com — si c'est une clé Pro, DeepL répondra 403."
    );
  }

  console.log(`[deepl] Appel traduction (${text.length} caractères)…`);

  try {
    const res = await fetch(DEEPL_FREE_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ text, target_lang: "FR" }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(
        `[deepl] Traduction a échoué (${res.status})${
          res.status === 403
            ? " — vérifie que DEEPL_API_KEY correspond bien au plan Free (suffixe ':fx') et à l'endpoint api-free.deepl.com"
            : ""
        }: ${body}`
      );
      return null;
    }

    const data = (await res.json()) as DeeplResponse;
    const translated = data.translations[0]?.text ?? null;
    console.log(
      translated
        ? "[deepl] Traduction reçue avec succès."
        : "[deepl] Réponse DeepL 200 mais sans texte traduit exploitable (structure inattendue)."
    );
    return translated;
  } catch (err) {
    console.error("[deepl] Erreur réseau lors de la traduction", err);
    return null;
  }
}
