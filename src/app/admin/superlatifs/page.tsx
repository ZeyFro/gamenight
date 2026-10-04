import { permanentRedirect } from "next/navigation";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Récompenses · Admin");

/** Absorbé dans le hub /admin (PR 8/9) — redirige pour ne pas casser les liens existants. */
export default function SuperlatifsAdminRedirect() {
  permanentRedirect("/admin?tab=superlatifs");
}
