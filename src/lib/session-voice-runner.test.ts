import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";

const runner = "scripts/discord-voice-collector.mjs";
const env = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  VOICE_PRESENCE_ENABLED: "true",
  DISCORD_BOT_TOKEN: "synthetic-token",
  VOICE_PRESENCE_GUILD_ID: "123456789012345678",
  VOICE_PRESENCE_CHANNEL_IDS: "456789012345678901",
  VOICE_PRESENCE_SESSION_ID: "synthetic-session",
  TEST_DATABASE_URL: "postgresql://test:test@127.0.0.1:1/no_connection",
};

describe("standalone voice runner (no network)", () => {
  it("defaults to an offline configuration/module check even with the flag enabled", () => {
    const result = spawnSync(process.execPath, [runner], { env, encoding: "utf8" });
    const generated = Prisma.dmmf.datamodel.models.some(model => model.name === "SessionVoicePresenceInterval");
    expect(result.status).toBe(generated ? 0 : 1);
    expect(generated ? result.stdout : result.stderr).toContain(generated ? "no connection opened" : "generated_client");
  });

  it("refuses a real run without an explicit local approval", () => {
    const result = spawnSync(process.execPath, [runner, "--run"], { env, encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("local_approval");
    expect(result.stderr).not.toContain("synthetic-token");
  });

  it("keeps the disabled flag inert even when asked to run", () => {
    expect(execFileSync(process.execPath, [runner, "--run"], { env: { ...env, VOICE_PRESENCE_ENABLED: "false" }, encoding: "utf8" })).toContain("disabled");
  });
});
