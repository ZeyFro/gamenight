import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import TowerArchiveConsole from "@/components/admin/TowerArchiveConsole";

export const metadata: Metadata = { title: "Archives privées — The Tower | GameNight" };
export default async function TowerArchivePage() {
  const admin = await requireAdmin();
  if (!admin || admin.discordId !== "699223334046531636") redirect("/");
  return <TowerArchiveConsole />;
}
