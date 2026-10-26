import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";
import {
  auditReportToCsv,
  collectDiscordAudit,
  TARGET_GUILD_ID,
} from "../../../../../scripts/audit-discord-guild.mjs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_RECOMMENDATION_TYPES = new Set(["guild_settings", "role", "channel", "scheduled_event"]);
const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function isSameSiteNavigation(request: NextRequest) {
  const fetchSite = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  return (fetchSite === "same-origin" || fetchSite === "none") &&
    (!origin || origin === request.nextUrl.origin);
}

function isSpecificAuditAdmin(discordId: string, rawAllowedIds: string | undefined) {
  return new Set((rawAllowedIds ?? "").split(",").map((id) => id.trim()).filter(Boolean)).has(discordId);
}

function projectServerConfiguration(report: Awaited<ReturnType<typeof collectDiscordAudit>>) {
  const guild = { ...report.guild };
  delete guild.description;
  const items = report.recommendations.items.filter((item) => ALLOWED_RECOMMENDATION_TYPES.has(item.resource_type));
  const byAction = Object.fromEntries(
    Object.entries(report.recommendations.by_action).map(([action, actionItems]) => [
      action,
      actionItems.filter((item) => ALLOWED_RECOMMENDATION_TYPES.has(item.resource_type)),
    ]),
  );
  const recommendations = {
    summary: Object.fromEntries(Object.entries(byAction).map(([action, actionItems]) => [action, actionItems.length])),
    items,
    by_action: byAction,
    policy: report.recommendations.policy,
    generated_at: report.recommendations.generated_at,
  };

  return {
    schema_version: report.schema_version,
    captured_at: report.captured_at,
    target: report.target,
    source: report.source,
    privacy: report.privacy,
    guild,
    roles: report.roles,
    channels: report.channels,
    scheduled_events: report.scheduled_events,
    recommendations,
  };
}

export async function GET(request: NextRequest) {
  if (!isSameSiteNavigation(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE_HEADERS });
  }

  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE_HEADERS });
  if (
    process.env.DISCORD_GUILD_AUDIT_ENABLED !== "true" ||
    !isSpecificAuditAdmin(admin.discordId, process.env.DISCORD_GUILD_AUDIT_ADMIN_IDS)
  ) {
    return new NextResponse(null, { status: 404, headers: NO_STORE_HEADERS });
  }

  const format = request.nextUrl.searchParams.get("format");
  if (format !== "json" && format !== "csv") {
    return NextResponse.json({ error: "format_must_be_json_or_csv" }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    const fullReport = await collectDiscordAudit({
      guildId: TARGET_GUILD_ID,
      token: process.env.DISCORD_BOT_TOKEN,
    });
    const report = projectServerConfiguration(fullReport);
    const timestamp = report.captured_at.replaceAll(":", "-").replaceAll(".", "-");
    const filename = `discord-audit-${TARGET_GUILD_ID}-${timestamp}.${format}`;
    const body = format === "json"
      ? `${JSON.stringify(report, null, 2)}\n`
      : auditReportToCsv(report);

    return new NextResponse(body, {
      status: 200,
      headers: {
        ...NO_STORE_HEADERS,
        "Content-Type": format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "discord_audit_failed" }, { status: 502, headers: NO_STORE_HEADERS });
  }
}
