import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import TowerLayoutClient from "@/components/admin/TowerLayoutClient";

export const metadata: Metadata = { title: "The Tower — administration Discord | GameNight" };

export default async function TowerLayoutPage() {
  const admin = await requireAdmin();
  if (!admin || admin.discordId !== "699223334046531636") redirect("/");
  return <TowerLayoutClient />;
}
