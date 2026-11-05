import Link from "next/link";
import { pageMetadata } from "@/lib/page-title";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { getTowerAdminHealth } from "@/lib/admin-health-summary";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata("Santé · Admin");

export default async function AdminHealthPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  const report = await getTowerAdminHealth();
  return <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
    <h1 className="text-2xl font-semibold">Santé de GameNight et The Tower</h1>
    <p className="text-sm text-muted">Lecture seule : aucun secret, destinataire ou contenu Discord affiché.</p>
    <section>
      <h2 className="font-semibold">Drapeaux de fonctionnalités</h2>
      <ul>{report.flags.map(flag =>
        <li key={flag.name} className="flex justify-between gap-4 border-b border-border py-2">
          <code>{flag.name}</code><span>{flag.enabled ? "Activé" : "Désactivé"}</span>
        </li>)}</ul>
    </section>
    <section>
      <h2 className="font-semibold">25 derniers échecs de notification Tower</h2>
      <ul>{report.failed.map((item,index) =>
        <li key={index} className="border-b border-border py-2 text-sm">
          {item.createdAt} · {item.eventType} · {item.errorCode}
        </li>)}</ul>
      {report.failed.length === 0 && <p>Aucun échec retrouvé dans cette fenêtre ; cela ne garantit pas une livraison réussie.</p>}
    </section>
    <section><h2 className="font-semibold">Dernière exécution des crons</h2>
      <p className="text-sm text-muted">{report.cronLastRuns}</p>
    </section>
    <Link href="/admin" className="text-accent underline">Retour à l&apos;administration</Link>
  </main>;
}
