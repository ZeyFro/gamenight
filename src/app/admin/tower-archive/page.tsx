import type { Metadata } from "next";
import { isTowerOwner, towerGuildId } from "@/lib/tower-config";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import TowerArchiveConsole from "@/components/admin/TowerArchiveConsole";

export const metadata: Metadata = { title: "Archives privées — The Tower | GameNight" };
export default async function TowerArchivePage() {
  const admin = await requireAdmin();
  if (!admin || !isTowerOwner(admin.discordId)) redirect("/");
  return <TowerArchiveConsole />;
}
