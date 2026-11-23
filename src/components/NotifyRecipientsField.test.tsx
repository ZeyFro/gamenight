// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});
