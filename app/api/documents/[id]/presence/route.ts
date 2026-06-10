import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { isParticipant } from "@/lib/authz";
import { heartbeat, leave, type PresenceSelection, type PresenceCursor, type PresenceScroll } from "@/lib/presence";

// Far beyond any realistic document length / version count, but keeps absurd
// integers out of the registry and the SSE fan-out.
const MAX_OFFSET = 10_000_000;

/** null = no selection; "invalid" = malformed payload (reject with 400). */
function parseSelection(raw: unknown): PresenceSelection | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "invalid";
  const { start, end, versionNumber } = raw as Record<string, unknown>;
  if (!Number.isInteger(start) || !Number.isInteger(end) || !Number.isInteger(versionNumber)) return "invalid";
  if ((start as number) < 0 || (start as number) >= (end as number) || (versionNumber as number) < 1) return "invalid";
  if ((end as number) > MAX_OFFSET || (versionNumber as number) > MAX_OFFSET) return "invalid";
  return { start, end, versionNumber } as PresenceSelection;
}

/** null = no cursor; "invalid" = malformed payload (reject with 400). */
function parseCursor(raw: unknown): PresenceCursor | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "invalid";
  const { x, y } = raw as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number") return "invalid";
  if (!Number.isFinite(x) || !Number.isFinite(y)) return "invalid";
  if (x < 0 || x > 1 || y < 0 || y > 1) return "invalid";
  return { x, y } as PresenceCursor;
}

/** null = no scroll; "invalid" = malformed payload (reject with 400). */
function parseScroll(raw: unknown): PresenceScroll | null | "invalid" {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return "invalid";
  const { y } = raw as Record<string, unknown>;
  if (typeof y !== "number" || !Number.isFinite(y)) return "invalid";
  if (y < 0 || y > 1) return "invalid";
  return { y } as PresenceScroll;
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!(await isParticipant(user.id, id))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (body?.leaving === true) {
    leave(id, user.id);
    return new Response(null, { status: 204 });
  }
  const selection = parseSelection(body?.selection);
  if (selection === "invalid") return NextResponse.json({ error: "invalid selection" }, { status: 400 });
  const cursor = parseCursor(body?.cursor);
  if (cursor === "invalid") return NextResponse.json({ error: "invalid cursor" }, { status: 400 });
  const scroll = parseScroll(body?.scroll);
  if (scroll === "invalid") return NextResponse.json({ error: "invalid scroll" }, { status: 400 });
  const name = (user.name && user.name.trim()) || user.email || "Someone";
  heartbeat(id, { userId: user.id, name }, selection, cursor, scroll);
  return new Response(null, { status: 204 });
}
