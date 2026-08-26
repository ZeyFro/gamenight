import { permanentRedirect } from "next/navigation";

/** Absorbé dans le hub /admin (PR 8/9) — redirige pour ne pas casser les liens existants. */
export default function SuperlatifsAdminRedirect() {
  permanentRedirect("/admin?tab=superlatifs");
}
