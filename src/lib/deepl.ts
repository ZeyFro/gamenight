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
      console.error(`[deepl] Traduction a échoué (${res.status}): ${body}`);
      return null;
    }

    const data = (await res.json()) as DeeplResponse;
    return data.translations[0]?.text ?? null;
  } catch (err) {
    console.error("[deepl] Erreur réseau lors de la traduction", err);
    return null;
  }
}
