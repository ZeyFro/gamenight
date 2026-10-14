import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { getMonthlyRecap } from "@/lib/monthly-recap";
import { RecapWrapped } from "@/components/RecapWrapped";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Récap du mois");

export default async function RecapPage({
  params,
}: {
  params: Promise<{ year: string; month: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { year: yearStr, month: monthStr } = await params;
  const year = Number(yearStr);
  const month = Number(monthStr);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    notFound();
  }

  const data = await getMonthlyRecap(year, month, user.id);
  if (!data) notFound();

  const monthLabel = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, 1)));

  return <RecapWrapped data={data} monthLabel={monthLabel} />;
}
