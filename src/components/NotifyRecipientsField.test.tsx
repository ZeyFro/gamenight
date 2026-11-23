// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { NotifyRecipientsField, type NotifyRecipientCandidate } from "./NotifyRecipientsField";

const potes: NotifyRecipientCandidate[] = ["Ana", "Bob", "Cléa"].map((name, i) => ({ id: `u${i}`, discordName: name, discordAvatar: null, color: "#ffffff", tagIds: [] }));
afterEach(cleanup);
const boxes = () => screen.getAllByRole("checkbox") as HTMLInputElement[];

describe("NotifyRecipientsField : cases cochées au départ", () => {
  it("par défaut (historique) : tous les potes sont cochés", () => {
    render(<NotifyRecipientsField potes={potes} />);
    expect(boxes().map((box) => box.checked)).toEqual([true, true, true]);
    expect(screen.getByText(/\(3\/3\)/)).toBeTruthy();
  });
  it("defaultSelection « none » : personne n'est coché, on coche à la main", () => {
    render(<NotifyRecipientsField potes={potes} defaultSelection="none" />);
    expect(boxes().map((box) => box.checked)).toEqual([false, false, false]);
    expect(screen.getByText(/\(0\/3\)/)).toBeTruthy();
    fireEvent.click(boxes()[1]);
    expect(boxes().map((box) => box.checked)).toEqual([false, true, false]);
    expect(screen.getByText(/\(1\/3\)/)).toBeTruthy();
  });
  it("« Tout sélectionner » reste possible après un départ à vide", () => {
    render(<NotifyRecipientsField potes={potes} defaultSelection="none" />);
    fireEvent.click(screen.getByText("Tout sélectionner"));
    expect(boxes().every((box) => box.checked)).toBe(true);
  });
  it("defaultCheckedIds : seules les personnes listées (les amis) sont cochées, et il l'emporte sur defaultSelection", () => {
    render(<NotifyRecipientsField potes={potes} defaultSelection="all" defaultCheckedIds={["u2"]} />);
    expect(boxes().map((box) => box.checked)).toEqual([false, false, true]);
    cleanup();
    render(<NotifyRecipientsField potes={potes} defaultCheckedIds={[]} />);
    expect(boxes().map((box) => box.checked)).toEqual([false, false, false]);
  });
});

describe("création de soirée : personne n'est prévenu d'office, vocabulaire sans jargon", () => {
  const planning = readFileSync("src/components/sessions/SessionPlanningFields.tsx", "utf8");
  const page = readFileSync("src/app/sessions/page.tsx", "utf8");
  it("le formulaire de planification part de initialGuestIds (vide par défaut), jamais de tous les potes", () => {
    expect(planning).toContain("initialGuestIds = []");
    expect(planning).not.toMatch(/useState\(\(\) => potes\.map\(\(pote\) => pote\.id\)\)/);
    expect(planning).toContain("defaultCheckedIds={initialGuestIds}");
  });
  it("la page ne pré-coche que les amis (Potes = amis allumé), sinon personne", () => {
    expect(page).toContain("isFriendsEnabled() ? await listFriendIds(user.id) : []");
  });
  it("pas de « deadline », « custom » ni « session » dans les textes visibles du formulaire", () => {
    const reminders = readFileSync("src/components/ReminderTimingsField.tsx", "utf8");
    for (const source of [page, reminders]) {
      expect(source).not.toMatch(/Deadline de vote|rappel custom|rappel perso\b/);
    }
    expect(page).toContain("Fin des votes");
    expect(page).toContain("{pote}");
  });
});
