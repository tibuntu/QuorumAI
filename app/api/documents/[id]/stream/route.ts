import { requireUser } from "@/lib/api";
import { subscribe, type DocEvent } from "@/lib/events";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!user) return new Response("unauthorized", { status: 401 });
  const { id } = await params;

  const encoder = new TextEncoder();
  let unsubscribe: () => void = () => {};
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: DocEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      unsubscribe = subscribe(id, send);
      controller.enqueue(encoder.encode(`: connected\n\n`));
      heartbeat = setInterval(() => controller.enqueue(encoder.encode(`: heartbeat\n\n`)), 25_000);
    },
    cancel() {
      unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
