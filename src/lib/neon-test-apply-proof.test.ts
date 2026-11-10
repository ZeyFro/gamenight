import { expect, it, vi } from "vitest";
import { verifyProof } from "../../scripts/neon-test/proof.mjs";
// Instantané fictif cohérent, indépendant des futures évolutions légitimes de main.
// Les empreintes opérateur réelles restent celles du manifest scellé, non modifié.
const { snapshots } = vi.hoisted(() => ({ snapshots: {
  ".github/workflows/neon-test-migrations.yml": "approved workflow",
  "scripts/neon-test-preflight.mjs": "approved preflight",
  "package.json": "approved package",
  "package-lock.json": "approved lock",
  "prisma/schema.prisma": "approved schema",
} as Record<string, string> }));
vi.mock("node:fs", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { createHash } = await import("node:crypto");
  return { ...actual, readFileSync: (path: string | URL, options?: BufferEncoding) => {
    if (String(path).endsWith("/approved-sources.json")) return JSON.stringify(Object.fromEntries(Object.entries(snapshots).map(([file, content]) => [file, createHash("sha256").update(content).digest("hex")])));
    return actual.readFileSync(path, options);
  } };
});
const env = { OPERATION: "validate", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "ZeyFro/gamenight", DRY_RUN_ID: "42300000000" };
const source = (path: string) => ({ encoding: "base64", content: Buffer.from(snapshots[path.slice("contents/".length).split("?ref=")[0]]).toString("base64") });
const validRun = () => ({ conclusion: "success", event: "workflow_dispatch", head_branch: "main", head_sha: "6d6e30e76f4f96acb25c37fa6f97f08f42dca6c7", path: ".github/workflows/neon-test-migrations.yml", updated_at: new Date().toISOString() });
it("accepte une preuve récente du workflow de dry-run scellé", async () => {
  await expect(verifyProof(env, async path => path.startsWith("contents/") ? source(path) : validRun())).resolves.toBeUndefined();
});
it.each(["failed", "stale", "branch", "path", "source", "preflight", "old-baseline"])("refuse la preuve %s", async variant => {
  const run = validRun();
  if (variant === "failed") run.conclusion = "failure";
  if (variant === "stale") run.updated_at = "2020-01-01T00:00:00Z";
  if (variant === "branch") run.head_branch = "other";
  if (variant === "path") run.path = ".github/workflows/ci.yml";
  if (variant === "old-baseline") run.head_sha = "b603dd03d398588f3a70086997f313af6e5dbbb1";
  await expect(verifyProof(env, async path => path.startsWith("contents/") ? ((variant === "source" || (variant === "preflight" && path.includes("neon-test-preflight.mjs")) || (variant === "old-baseline" && /package(-lock)?\.json/.test(path))) ? { encoding: "base64", content: "" } : source(path)) : run)).rejects.toThrow();
});
it("exige une preuve de restauration et un accord explicite de ZeyFro avant apply", async () => {
  const apply = { ...env, OPERATION: "apply", APPLY_AUTHORIZATION: "370-406-test-only", CONFIRMATION: "APPLY-370-406-ON-TEST", RESTORATION_EVIDENCE: "https://github.com/ZeyFro/gamenight/issues/400#issuecomment-123" };
  const comment = { user: { login: "ZeyFro" }, issue_url: "https://api.github.com/repos/ZeyFro/gamenight/issues/400", updated_at: new Date().toISOString(), body: ["RESTORATION_TEST_VALIDATED=true", "BACKUP_READY=true", "APPLY_TEST_370_406_APPROVED=true", "BACKUP_BRANCH=br-purple-mud-b1nt0tfi", "TARGET_BRANCH=br-snowy-snow-b1cggq2w"].join("\n") };
  const get = async (path: string) => path.startsWith("contents/") ? source(path) : path.startsWith("issues/") ? comment : validRun();
  await expect(verifyProof(apply, get)).resolves.toBeUndefined();
  const approvedBody = comment.body;
  for (const key of ["RESTORATION_TEST_VALIDATED", "BACKUP_READY", "APPLY_TEST_370_406_APPROVED"]) {
    comment.body = approvedBody.replace(key + "=true", key + "=false");
    await expect(verifyProof(apply, get)).rejects.toThrow("RESTORATION");
    comment.body = approvedBody + "\n" + key + "=true";
    await expect(verifyProof(apply, get)).rejects.toThrow("RESTORATION");
  }
  comment.body = approvedBody;
  comment.user.login = "other";
  await expect(verifyProof(apply, get)).rejects.toThrow("RESTORATION");
  comment.user.login = "ZeyFro";
  comment.body = "BACKUP_READY";
  await expect(verifyProof(apply, get)).rejects.toThrow("RESTORATION");
});

it("refuse un identifiant de dry-run vide", async () => {
  await expect(verifyProof({ ...env, DRY_RUN_ID: "" }, async () => validRun())).rejects.toThrow();
});
