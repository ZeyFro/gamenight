// @vitest-environment jsdom
import React, { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import TowerArchiveConsole from "./TowerArchiveConsole";
import TowerLayoutClient from "./TowerLayoutClient";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe.each([
  ["archives", TowerArchiveConsole, "/api/admin/tower-archive"],
  ["salons", TowerLayoutClient, "/api/admin/tower-layout"],
] as const)("console %s", (_name, Console, endpoint) => {
  it("ignore la réponse obsolète du premier montage puis permet de réessayer", async () => {
    let finishOld!: (response: Response) => void;
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; }))
      .mockResolvedValue(Response.json({ totalChannels: 7, preview: [] }));
    vi.stubGlobal("fetch", fetcher);
    render(<StrictMode><Console /></StrictMode>);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await waitFor(() => expect((screen.getByRole("button", { name: /Actualiser/ }) as HTMLButtonElement).disabled).toBe(false));
    await act(async () => { finishOld(Response.json({ error: "Réponse obsolète" }, { status: 403 })); });
    expect(screen.queryByRole("alert")).toBeNull();
    fetcher.mockRejectedValueOnce(new Error("Connexion interrompue"));
    fireEvent.click(screen.getByRole("button", { name: /Actualiser/ }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", expect.stringContaining("Connexion interrompue"));
    fetcher.mockResolvedValueOnce(Response.json({ totalChannels: 7, preview: [] }));
    fireEvent.click(screen.getByRole("button", { name: /Actualiser/ }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(fetcher.mock.calls.every(([url, options]) => url === endpoint && options.cache === "no-store")).toBe(true);
  });
});
