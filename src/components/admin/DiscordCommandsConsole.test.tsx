// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DiscordCommandsConsole } from "./DiscordCommandsConsole";

const SECRET = "SECRET-SAISI-PAR-L-ADMIN";
const fetchMock = vi.fn();

function reply(status: number, body: unknown) {
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function typeSecret() {
  const input = screen.getByLabelText("Secret d’enregistrement") as HTMLInputElement;
  expect(input.type).toBe("password");
  fireEvent.change(input, { target: { value: SECRET } });
  return input;
}

describe("DiscordCommandsConsole", () => {
  it("boutons désactivés tant qu'aucun secret n'est saisi", () => {
    render(<DiscordCommandsConsole />);
    expect((screen.getByRole("button", { name: "Vérifier" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Vérifier : POST mode check avec l'en-tête x-registration-secret, affiche le tableau, efface le secret", async () => {
    reply(200, {
      mode: "check",
      ok: true,
      commands: [
        { name: "aide", kind: "chat", status: "absente" },
        { name: "Signaler", kind: "message", status: "présente" },
      ],
      outsideManifest: 2,
      failure: null,
    });
    const storage = vi.spyOn(Storage.prototype, "setItem");
    const log = vi.spyOn(console, "log");
    render(<DiscordCommandsConsole />);
    const input = typeSecret();
    fireEvent.click(screen.getByRole("button", { name: "Vérifier" }));

    await waitFor(() => expect(screen.getByRole("table")).toBeTruthy());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/discord-commands");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-registration-secret"]).toBe(SECRET);
    expect(JSON.parse(String(init.body))).toEqual({ mode: "check" });
    expect(screen.getByText("/aide")).toBeTruthy();
    expect(screen.getByText("absente")).toBeTruthy();
    expect(screen.getByText(/2 commande\(s\) du serveur hors manifeste/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("HTTP 200");
    expect(input.value).toBe("");
    expect(storage).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("Enregistrer : demande confirmation puis POST mode execute ; refus de confirmation = aucun appel", async () => {
    reply(200, { mode: "execute", ok: true, commands: [{ name: "aide", kind: "chat", status: "enregistrée" }], outsideManifest: null, failure: null });
    render(<DiscordCommandsConsole />);
    typeSecret();
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(screen.getByText("enregistrée")).toBeTruthy());
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ mode: "execute" });
  });

  it("refus de la route (401, 404) et échec Discord (502) : statut expliqué, sans tableau", async () => {
    render(<DiscordCommandsConsole />);
    for (const [status, text] of [
      [401, "Secret faux"],
      [404, "Fonction éteinte"],
    ] as const) {
      reply(status, { error: "x" });
      typeSecret();
      fireEvent.click(screen.getByRole("button", { name: "Vérifier" }));
      await waitFor(() => expect(screen.getByRole("status").textContent).toContain(text));
      expect(screen.queryByRole("table")).toBeNull();
    }
    reply(502, { mode: "check", ok: false, commands: [], outsideManifest: null, failure: { stage: "read", http: 403, code: "50001", hint: "Réinviter l'application." } });
    typeSecret();
    fireEvent.click(screen.getByRole("button", { name: "Vérifier" }));
    await waitFor(() => expect(screen.getByText(/code Discord 50001/)).toBeTruthy());
  });
});
