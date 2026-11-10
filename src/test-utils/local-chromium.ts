import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Chromium local via CDP natif Node22 : aucune dépendance ni navigation distante. */
export class LocalChromium {
  private process: ChildProcess;
  private directory: string;
  private socket!: WebSocket;
  private session?: string;
  private sequence = 0;
  private pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  private constructor(executable: string) {
    this.directory = mkdtempSync(join(tmpdir(), "gamenight-header-browser-"));
    this.process = spawn(executable, ["--headless", "--no-sandbox", "--disable-gpu", "--disable-background-networking", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${this.directory}`, "about:blank"], { stdio: "ignore" });
  }

  static async open() {
    const executable = ["/usr/bin/chromium", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"].find(path => existsSync(path));
    if (!executable) throw new Error("Chrome/Chromium local requis pour le test tactile, à un emplacement standard.");
    const browser = new LocalChromium(executable);
    try {
      const portFile = join(browser.directory, "DevToolsActivePort");
      for (let attempt = 0; !existsSync(portFile) && attempt < 100; attempt++) await delay(50);
      const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");
      browser.socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
      browser.socket.addEventListener("message", event => {
        const message = JSON.parse(String(event.data));
        const pending = browser.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        browser.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Connexion CDP locale expirée")), 5000);
        browser.socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
        browser.socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Connexion CDP locale refusée")); }, { once: true });
      });
      const target = await browser.command("Target.createTarget", { url: "about:blank" }) as { targetId: string };
      const attached = await browser.command("Target.attachToTarget", { targetId: target.targetId, flatten: true }) as { sessionId: string };
      browser.session = attached.sessionId;
      await browser.command("Page.enable");
      await browser.command("Network.enable");
      await browser.command("Network.setBlockedURLs", { urls: ["http://*", "https://*"] });
      return browser;
    } catch (error) {
      await browser.close();
      throw error;
    }
  }

  async command(method: string, params: Record<string, unknown> = {}) {
    const id = ++this.sequence;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Commande CDP expirée : ${method}`)); }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params, ...(this.session ? { sessionId: this.session } : {}) }));
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const reply = await this.command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }) as { result: { value: T }; exceptionDetails?: { text: string } };
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.text);
    return reply.result.value;
  }

  async render(html: string, width: number, touch: boolean) {
    await this.command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: touch });
    await this.command("Emulation.setTouchEmulationEnabled", { enabled: touch, maxTouchPoints: 1 });
    await this.evaluate(`document.open();document.write(${JSON.stringify(html)});document.close();`);
    await this.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))");
  }

  async close() {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error("Navigateur fermé")); }
    this.pending.clear();
    if (this.socket?.readyState === WebSocket.OPEN && this.process.exitCode === null && this.process.signalCode === null) {
      const exited = new Promise<void>(resolve => this.process.once("exit", () => resolve()));
      this.socket.send(JSON.stringify({ id: ++this.sequence, method: "Browser.close" }));
      await Promise.race([exited, delay(3000)]);
    }
    this.socket?.close();
    if (this.process.exitCode === null && this.process.signalCode === null) {
      const exited = new Promise<void>(resolve => this.process.once("exit", () => resolve()));
      this.process.kill("SIGTERM");
      await Promise.race([exited, delay(3000)]);
      if (this.process.exitCode === null && this.process.signalCode === null) { this.process.kill("SIGKILL"); await exited; }
    }
    rmSync(this.directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}
