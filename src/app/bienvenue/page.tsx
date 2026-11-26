import { signIn } from "@/auth";
import { getCurrentUser } from "@/lib/current-user";
import { getOnboardingProgress } from "@/lib/onboarding";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { LoginLanding } from "@/components/app/LoginLanding";
import { Button } from "@/components/ui/Button";
import { pageMetadata } from "@/lib/page-title";
import { prisma } from "@/lib/prisma";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { DEFAULT_COMMUNITY_SLUG } from "@/lib/default-community";

export const metadata = pageMetadata("Bienvenue");

const DISCORD_ID_PATTERN = /^\d{17,20}$/;

/** Resolve the configured command shortcut for the active community.
 * The legacy command channel exists only for the default guild; never reuse
 * it for another community. Until a community-specific command-channel
 * setting exists, other communities keep the slash-command instructions
 * without a cross-server link.
 */
async function getOnboardingConfiguration(userId: string): Promise<{ commandsChannelUrl: string | null; towerAvailable: boolean }> {
  const communityId = await resolveActiveCommunityId(userId);
  if (!communityId) return { commandsChannelUrl: null, towerAvailable: false };
  const community = await prisma.community.findUnique({
    where: { id: communityId },
    select: { slug: true, status: true, discordGuildId: true, towerChallengesEnabled: true },
  });
  const towerAvailable = process.env.TOWER_CHALLENGES_ENABLED === "true" &&
    community?.status === "ACTIVE" && community.towerChallengesEnabled;
  const configuredGuildId = community?.discordGuildId?.trim();
  const defaultGuildId = process.env.DISCORD_BOT_GUILD_ID?.trim();
  const configuredChannelId = process.env.TOWER_DISCORD_COMMANDS_CHANNEL_ID?.trim();
  const commandsChannelUrl = community?.status === "ACTIVE" &&
    community.slug === DEFAULT_COMMUNITY_SLUG &&
    configuredGuildId &&
    configuredGuildId === defaultGuildId &&
    configuredChannelId &&
    DISCORD_ID_PATTERN.test(configuredGuildId) &&
    DISCORD_ID_PATTERN.test(configuredChannelId)
    ? `https://discord.com/channels/${configuredGuildId}/${configuredChannelId}`
    : null;
  return { commandsChannelUrl, towerAvailable };
}

export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const { step } = await searchParams;
  const initialStep = step === "steam" || step === "planning" ? step : undefined;
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) return <LoginLanding><form action={async () => {
    "use server";
    await signIn("discord", { redirectTo: `/bienvenue${initialStep ? `?step=${initialStep}` : ""}` });
  }}><Button type="submit" variant="primary">Se connecter pour préparer mon profil</Button></form></LoginLanding>;
  const progress = await getOnboardingProgress(user.id);
  if (!progress) return null;
  const onboardingConfig = await getOnboardingConfiguration(user.id);
  return <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6"><OnboardingFlow key={initialStep ?? "auto"} progress={progress} initialStep={initialStep} commandsChannelUrl={onboardingConfig.commandsChannelUrl} towerAvailable={onboardingConfig.towerAvailable} /></div>;
}
