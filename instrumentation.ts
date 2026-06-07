// Next.js calls register() once at server startup (nodejs runtime only, never at build).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerEmailDigestHandler } = await import("@/lib/email-digest");
  const { registerWebhookHandler } = await import("@/lib/webhooks");
  const { startOutboxWorker } = await import("@/lib/outbox");
  registerEmailDigestHandler();
  registerWebhookHandler();
  startOutboxWorker();
}
