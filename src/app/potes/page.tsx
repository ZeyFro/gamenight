import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Stagger, StaggerItem } from "@/components/motion";

export default async function PotesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const potes = await prisma.user.findMany({
    where: { id: { not: user.id } },
    orderBy: { discordName: "asc" },
    include: {
      _count: { select: { userGames: { where: { owned: true } } } },
    },
  });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
        Potes
      </h1>

      {potes.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            Personne d&apos;autre n&apos;a encore rejoint le groupe.
          </p>
        </Card>
      ) : (
        <Stagger className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {potes.map((pote) => (
            <StaggerItem key={pote.id}>
              <Link href={`/potes/${pote.id}`}>
                <Card className="flex items-center gap-4" glow>
                  <Avatar
                    src={pote.discordAvatar}
                    alt={pote.discordName}
                    size={48}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-foreground">
                      {pote.discordName}
                    </p>
                    <p className="text-sm text-muted">
                      {pote._count.userGames} jeu
                      {pote._count.userGames !== 1 ? "x" : ""}
                    </p>
                  </div>
                  <Badge tone={pote.steamId64 ? "accent" : "neutral"}>
                    {pote.steamId64 ? "Steam lié" : "Steam non lié"}
                  </Badge>
                </Card>
              </Link>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}
