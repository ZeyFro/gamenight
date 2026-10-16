import { Button } from "@/components/ui/Button";
import { rateSessionAction } from "@/app/sessions/actions/ratings";

export function SessionRatingForm({ sessionId, rating }: { sessionId: string; rating: number | null }) {
  return (
    <form action={rateSessionAction} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={sessionId} />
      <fieldset>
        <legend className="text-sm font-medium text-foreground">Ta note de la soirée</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {[1, 2, 3, 4, 5].map((value) => (
            <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 text-sm text-foreground">
              <input type="radio" name="rating" value={value} required defaultChecked={rating === value} />
              <span>{value} / 5</span>
            </label>
          ))}
        </div>
      </fieldset>
      <Button type="submit" size="sm" className="self-start">Enregistrer ma note</Button>
    </form>
  );
}
