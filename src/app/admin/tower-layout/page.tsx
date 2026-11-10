import type { Metadata } from "next";
import { isTowerOwner, towerGuildId } from "@/lib/tower-config";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import TowerLayoutClient from "@/components/admin/TowerLayoutClient";

export const metadata: Metadata = { title: "The Tower — administration Discord | GameNight" };

export default async function TowerLayoutPage() {
  const admin = await requireAdmin();
  if (!admin || !isTowerOwner(admin.discordId)) redirect("/");
  return <TowerLayoutClient />;
}
