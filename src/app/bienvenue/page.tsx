import { signIn } from "@/auth";
import { getCurrentUser } from "@/lib/current-user";
import { getOnboardingProgress } from "@/lib/onboarding";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";
import { LoginLanding } from "@/components/app/LoginLanding";
import { Button } from "@/components/ui/Button";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Bienvenue");

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
  return <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6"><OnboardingFlow key={initialStep ?? "auto"} progress={progress} initialStep={initialStep} /></div>;
}
