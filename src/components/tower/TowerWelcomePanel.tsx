import { ButtonLink } from "@/components/ui/Button";
import { TOWER_ONBOARDING_ACTIONS } from "@/lib/tower-onboarding-actions";

export function TowerWelcomePanel() {
  return (
    <nav aria-label="Premiers pas dans The Tower" className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {TOWER_ONBOARDING_ACTIONS.map((action) => (
        <ButtonLink key={action.id} href={action.id === "players" ? "/tower/forums" : action.path} fullWidthOnMobile>
          {action.label}
        </ButtonLink>
      ))}
    </nav>
  );
}
