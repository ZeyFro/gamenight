"use client";

import { AnimatedCircularProgressBar } from "@/components/magicui/animated-circular-progress-bar";
import { MagicCard } from "@/components/magicui/magic-card";
import { levelForXp, rankForLevel, xpForLevel } from "@/lib/xp";

export function XpProgress({ xp }: { xp: number }) {
  const level = levelForXp(xp);
  const earned = xp - xpForLevel(level);
  const next = xpForLevel(level + 1) - xpForLevel(level);
  const percent = Math.max(0, Math.min(100, earned / next * 100));
  return <MagicCard className="gn-xp-panel" gradientColor="#b99aff25" gradientFrom="#b99aff" gradientTo="#d4ef80">
    <div className="gn-xp-inner">
      <div role="progressbar" aria-label={`Progression vers le niveau ${level + 1}`} aria-valuemin={0} aria-valuemax={next} aria-valuenow={earned} aria-valuetext={`${earned} XP sur ${next}`}>
        <div aria-hidden="true"><AnimatedCircularProgressBar value={percent} gaugePrimaryColor="#b99aff" gaugeSecondaryColor="#3d354a" className="size-28 sm:size-32" /></div>
      </div>
      <div className="min-w-0"><span className="gn-eyebrow" style={{ color: "var(--gn-lime)" }}>{rankForLevel(level).name}</span><h2>Niveau {level}</h2><b className="text-lg tabular-nums">{xp.toLocaleString("fr-FR")} XP</b><p className="mt-2">{earned} / {next} XP vers le niveau {level + 1}</p></div>
    </div>
  </MagicCard>;
}
