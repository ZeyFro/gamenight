import { describe, expect, it } from "vitest";
import { isQuickPollClosed, parseQuickPollInput, parseQuickPollOption, quickPollResults } from "./community-quick-polls-input";

const input = { question: "  On joue quand ? ", options: [" Ce soir ", "Demain"], durationMinutes: "60" };
describe("sondages éclair : saisie et résultats", () => {
  it("nettoie le texte et accepte une durée entière de 1 minute à 7 jours", () => {
    expect(parseQuickPollInput(input)).toEqual({ question: "On joue quand ?", options: ["Ce soir", "Demain"], durationMinutes: 60 });
    for (const durationMinutes of [1, 10080]) expect(parseQuickPollInput({ ...input, durationMinutes })).not.toBeNull();
  });
  it.each([
    { question: " " }, { question: "x".repeat(201) }, { options: ["Seul"] },
    { options: Array.from({ length: 7 }, (_, index) => `${index}`) }, { options: ["Oui", " OUI "] },
    { options: ["", "Non"] }, { options: ["x".repeat(81), "Non"] },
    { durationMinutes: 0 }, { durationMinutes: 10081 }, { durationMinutes: 1.5 },
    { durationMinutes: true }, { durationMinutes: "" }, { durationMinutes: new File([], "duree.txt") },
  ])("refuse %j", invalid => expect(parseQuickPollInput({ ...input, ...invalid })).toBeNull());
  it.each([null, "", "-1", "6", "1.5", "1e0", new File([], "vote.txt")])("refuse une réponse invalide %s", value => {
    expect(parseQuickPollOption(value)).toBeNull();
  });
  it("conserve les options sans vote et ne publie que les comptes", () => {
    expect(quickPollResults(["Oui", "Non"], [{ optionIndex: 1, count: 2 }])).toEqual([{ label: "Oui", count: 0 }, { label: "Non", count: 2 }]);
    expect(parseQuickPollOption("0")).toBe(0); expect(parseQuickPollOption("5")).toBe(5);
  });
  it("ferme exactement à l’échéance", () => {
    const end = new Date("2026-10-17T10:00:00Z");
    expect(isQuickPollClosed(end, new Date(end.getTime() - 1))).toBe(false);
    expect(isQuickPollClosed(end, end)).toBe(true);
    expect(isQuickPollClosed(end, new Date(end.getTime() + 1))).toBe(true);
  });
});
