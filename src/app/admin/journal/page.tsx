import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { listSensitiveOperations } from "@/lib/sensitive-operation-log";
import { Card } from "@/components/ui/Card";
import { pageMetadata } from "@/lib/page-title";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata("Journal des opérations sensibles · Admin");

const dateFr = (value: Date) =>
  new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Paris" }).format(value);

/** Cahier §19.1 : lecture seule, administrateurs seulement. */
export default async function SensitiveOperationsPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  const rows = await listSensitiveOperations();
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/admin" className="text-sm text-accent underline-offset-4 hover:underline">← Administration</Link>
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Journal des opérations sensibles</h1>
        <p className="mt-1 text-sm text-muted">Les 100 dernières actions d’administration : qui, quoi, où, résultat. Aucun texte saisi, aucun secret.</p>
      </header>
      <Card>
        {rows.length === 0 ? <p className="text-sm text-muted">Aucune opération enregistrée.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Opérations sensibles, de la plus récente à la plus ancienne</caption>
              <thead>
                <tr className="border-b border-border text-muted">
                  <th scope="col" className="py-2 pr-3">Date (Paris)</th>
                  <th scope="col" className="py-2 pr-3">Auteur</th>
                  <th scope="col" className="py-2 pr-3">Action</th>
                  <th scope="col" className="py-2 pr-3">Cible</th>
                  <th scope="col" className="py-2">Résultat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border align-top">
                    <td className="whitespace-nowrap py-2 pr-3">{dateFr(row.createdAt)}</td>
                    <td className="py-2 pr-3">{row.actorName}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{row.action}</td>
                    <td className="break-all py-2 pr-3 font-mono text-xs">{row.target ?? row.communityRef ?? "—"}</td>
                    <td className="py-2 font-mono text-xs">{row.outcome}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}
