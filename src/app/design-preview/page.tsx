import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { DesignPreviewHome } from "@/design/preview/DesignPreviewHome";
import "@/design/tokens.css";
import "@/design/design.css";

/**
 * Aperçu de la refonte « centre de commande » (lot R1). Page de
 * démonstration : derrière la même authentification que le reste de l'app
 * (`getCurrentUser`, qui tient compte de la reconnexion forcée), jamais
 * indexée, et SANS aucune donnée réelle — tout vient de
 * `src/design/preview/fake-data.ts`. Le seul accès base de cette route est
 * la vérification de session déjà faite par le layout racine.
 */
export const metadata: Metadata = {
  title: "Aperçu du design — GameNight",
  robots: { index: false, follow: false, nocache: true },
};

export default async function DesignPreviewPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  return <DesignPreviewHome />;
}
