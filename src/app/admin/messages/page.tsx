import { permanentRedirect } from "next/navigation";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Messages · Admin");

/** Absorbé dans le hub /admin (PR 8/9) — redirige pour ne pas casser les liens existants. */
export default function MessagesAdminRedirect() {
  permanentRedirect("/admin?tab=messages");
}
