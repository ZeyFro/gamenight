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

function confirmWrite() {
  fireEvent.click(screen.getByRole("checkbox", { name: /Je confirme/ }));
}

function typeSecret() {
  const input = screen.getByLabelText("Secret d’enregistrement") as HTMLInputElement;
  expect(input.type).toBe("password");
  fireEvent.change(input, { target: { value: SECRET } });
  return input;
}

describe("DiscordCommandsConsole", () => {
  it("enregistrement partiel (202, limite de débit) : 13 lignes, délai affiché, et un second clic relance sans ressaisir le secret", async () => {
    const commands = Array.from({ length: 13 }, (_, i) => ({ name: `cmd${i}`, kind: "chat", status: i < 5 ? "enregistrée" : "en attente" }));
    reply(202, { mode: "execute", ok: false, commands, outsideManifest: 0, failure: { stage: "rate_limit", command: "cmd5", http: 429, retryAfterSeconds: 12 } });
    render(<DiscordCommandsConsole />);
    typeSecret();
    confirmWrite();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(screen.getByText(/Attends 12 s/)).toBeTruthy());
    expect(screen.getAllByRole("row")).toHaveLength(14);
    expect(screen.getByLabelText("Résumé").textContent).toContain("5 enregistrée · 8 en attente sur 13 commandes");
    expect(screen.getByRole("status").textContent).toContain("HTTP 202");

    reply(200, { mode: "execute", ok: true, commands: commands.map((c) => ({ ...c, status: c.status === "enregistrée" ? "déjà à jour" : "enregistrée" })), outsideManifest: 0, failure: null });
    const again = screen.getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement;
    expect(again.disabled).toBe(false);
    fireEvent.click(again);
    await waitFor(() => expect(screen.getByLabelText("Résumé").textContent).toContain("8 enregistrée · 5 déjà à jour"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[1].headers).toMatchObject({ "x-registration-secret": SECRET });
  });

  it("boutons désactivés tant qu'aucun secret n'est saisi", () => {
    render(<DiscordCommandsConsole />);
    expect((screen.getByRole("button", { name: "Vérifier" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Tout enregistrer d’un coup" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Vérifier : POST mode check avec l'en-tête x-registration-secret, affiche le tableau, garde le secret en mémoire seulement", async () => {
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
    expect(input.value).toBe(SECRET);
    expect(storage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Effacer le secret" }));
    expect(input.value).toBe("");
    expect(log).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(SECRET);
  });

  it("Enregistrer : case « Je confirme » obligatoire (aucune fenêtre du navigateur), puis POST mode execute", async () => {
    reply(200, { mode: "execute", ok: true, commands: [{ name: "aide", kind: "chat", status: "enregistrée" }], outsideManifest: null, failure: null });
    render(<DiscordCommandsConsole />);
    typeSecret();
    const button = screen.getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(fetchMock).not.toHaveBeenCalled();

    confirmWrite();
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText("enregistrée")).toBeTruthy());
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ mode: "execute" });
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("Tout enregistrer d’un coup : POST mode bulk une seule fois, sans fenêtre de confirmation, après la case", async () => {
    reply(200, { mode: "bulk", ok: true, commands: Array.from({ length: 13 }, (_, i) => ({ name: `cmd${i}`, kind: "chat", status: "enregistrée" })), outsideManifest: 0, failure: null });
    render(<DiscordCommandsConsole />);
    typeSecret();
    const button = screen.getByRole("button", { name: "Tout enregistrer d’un coup" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    confirmWrite();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByLabelText("Résumé").textContent).toContain("13 enregistrée sur 13 commandes"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ mode: "bulk" });
    expect(window.confirm).not.toHaveBeenCalled();
  });

  it("refus 409 (commandes hors manifeste) : message explicite, aucune écriture annoncée", async () => {
    reply(409, { mode: "bulk", ok: false, commands: [{ name: "aide", kind: "chat", status: "en attente" }], outsideManifest: 2, failure: { stage: "outside_manifest", hint: "2 commande(s) hors manifeste." } });
    render(<DiscordCommandsConsole />);
    typeSecret();
    confirmWrite();
    fireEvent.click(screen.getByRole("button", { name: "Tout enregistrer d’un coup" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("HTTP 409"));
    expect(screen.getByRole("status").textContent).toContain("hors manifeste");
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
