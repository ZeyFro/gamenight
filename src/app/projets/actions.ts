"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import { idSchema } from "@/lib/validations";
import { parseDateAndTime } from "@/lib/wallclock";
import {
  applyToProject,
  closeProject,
  createProject,
  decideProjectEntry,
  getProjectsCommunityId,
  renewProject,
  withdrawFromProject,
} from "@/lib/projects";

function back(path: string, result: string): never {
  revalidatePath("/projets");
  redirect(`${path}?result=${result}`);
}

async function authorized(action: string, path: string) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getProjectsCommunityId(user.id);
  if (!communityId) redirect("/projets");
  if (!checkRateLimit(user.id, action)) back(path, "rate");
  return { user, communityId };
}

export async function createProjectAction(formData: FormData): Promise<void> {
  const { user, communityId } = await authorized("createProject", "/projets");
  const date = String(formData.get("endDate") ?? "");
  const time = String(formData.get("endTime") ?? "") || "23:59";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) back("/projets", "invalid");
  const result = await createProject(
    user.id,
    communityId,
    { name: formData.get("name"), description: formData.get("description"), gameName: formData.get("gameName"), maxEntries: formData.get("maxEntries") },
    parseDateAndTime(date, time),
  );
  if (!result.ok) back("/projets", result.reason);
  revalidatePath("/projets");
  redirect(`/projets/${result.projectId}?result=created`);
}

export async function applyToProjectAction(formData: FormData): Promise<void> {
  const projectId = idSchema.safeParse(formData.get("projectId"));
  if (!projectId.success) redirect("/projets");
  const path = `/projets/${projectId.data}`;
  const { user, communityId } = await authorized("applyToProject", path);
  const result = await applyToProject(user.id, communityId, projectId.data, String(formData.get("message") ?? ""));
  back(path, result.ok ? "applied" : result.reason);
}

export async function withdrawFromProjectAction(formData: FormData): Promise<void> {
  const projectId = idSchema.safeParse(formData.get("projectId"));
  if (!projectId.success) redirect("/projets");
  const path = `/projets/${projectId.data}`;
  const { user, communityId } = await authorized("withdrawFromProject", path);
  const result = await withdrawFromProject(user.id, communityId, projectId.data);
  back(path, result.ok ? "withdrawn" : result.reason);
}

export async function decideProjectEntryAction(formData: FormData): Promise<void> {
  const projectId = idSchema.safeParse(formData.get("projectId"));
  const entryId = idSchema.safeParse(formData.get("entryId"));
  if (!projectId.success || !entryId.success) redirect("/projets");
  const path = `/projets/${projectId.data}`;
  const { user, communityId } = await authorized("decideProjectEntry", path);
  const decision = String(formData.get("decision")) === "ACCEPT" ? "ACCEPT" : "DECLINE";
  const result = await decideProjectEntry(user.id, communityId, entryId.data, decision);
  back(path, result.ok ? (decision === "ACCEPT" ? "accepted" : "declined") : result.reason);
}

export async function renewProjectAction(formData: FormData): Promise<void> {
  const projectId = idSchema.safeParse(formData.get("projectId"));
  if (!projectId.success) redirect("/projets");
  const path = `/projets/${projectId.data}`;
  const { user, communityId } = await authorized("renewProject", path);
  const date = String(formData.get("endDate") ?? "");
  const time = String(formData.get("endTime") ?? "") || "23:59";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) back(path, "invalid");
  const result = await renewProject(user.id, communityId, projectId.data, parseDateAndTime(date, time));
  back(path, result.ok ? "renewed" : result.reason);
}

export async function closeProjectAction(formData: FormData): Promise<void> {
  const projectId = idSchema.safeParse(formData.get("projectId"));
  if (!projectId.success) redirect("/projets");
  const path = `/projets/${projectId.data}`;
  const { user, communityId } = await authorized("closeProject", path);
  const result = await closeProject(user.id, communityId, projectId.data);
  back(path, result.ok ? "closed" : result.reason);
}
