// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { CreationForm } from "./CreationForm";
afterEach(cleanup);

it("double clic : attente visible et un seul appel ; réponse perdue : même clé réutilisée", async () => {
  const keys: string[] = [];
  let reject!: (error: Error) => void;
  const action = vi.fn(async (form: FormData) => {
    keys.push(String(form.get("creationKey")));
    await new Promise<void>((_resolve, fail) => { reject = fail; });
  });
  render(<CreationForm action={action}><input name="name" defaultValue="identique" /><button type="submit">Créer</button></CreationForm>);
  fireEvent.click(screen.getByText("Créer"));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("status").textContent).toContain("Création en cours");
  expect(screen.getByRole("group").hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByText("Créer"));
  expect(action).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("réponse perdue")));
  expect(screen.getByRole("alert").textContent).toContain("sans doublon");
  fireEvent.click(screen.getByText("Créer"));
  await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
  expect(keys[1]).toBe(keys[0]);
  await act(async () => reject(new Error("réponse perdue")));
});

it("un nouveau formulaire obtient une nouvelle clé pour une création volontaire identique", async () => {
  const keys: string[] = [];
  const action = async (data: FormData) => { keys.push(String(data.get("creationKey"))); };
  const first = render(<CreationForm action={action}><button type="submit">Créer</button></CreationForm>);
  fireEvent.click(screen.getByText("Créer"));
  await waitFor(() => expect(keys).toHaveLength(1));
  first.unmount();
  render(<CreationForm action={action}><button type="submit">Créer</button></CreationForm>);
  fireEvent.click(screen.getByText("Créer"));
  await waitFor(() => expect(keys).toHaveLength(2));
  expect(keys[1]).not.toBe(keys[0]);
});
