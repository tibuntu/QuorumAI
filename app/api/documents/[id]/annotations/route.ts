import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { createAnnotation } from "@/lib/annotations";
import { ANNOTATION_KINDS, type AnnotationKind } from "@/lib/enums";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (
    !body ||
    typeof body.body !== "string" ||
    typeof body.startOffset !== "number" ||
    typeof body.endOffset !== "number" ||
    !body.quote ||
    typeof body.quote.exact !== "string" ||
    typeof body.quote.prefix !== "string" ||
    typeof body.quote.suffix !== "string"
  ) {
    return NextResponse.json({ error: "quote, startOffset, endOffset and body required" }, { status: 400 });
  }
  const kind: AnnotationKind | undefined =
    typeof body.kind === "string" && ANNOTATION_KINDS.includes(body.kind as AnnotationKind)
      ? (body.kind as AnnotationKind)
      : undefined;
  const annotation = await createAnnotation(
    user.id,
    id,
    { quote: body.quote, startOffset: body.startOffset, endOffset: body.endOffset, kind },
    body.body
  );
  return NextResponse.json({ annotation }, { status: 201 });
}
