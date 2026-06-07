import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listWebhooks } from "@/lib/webhooks";
import WebhookManager from "@/components/WebhookManager";

export default async function WebhooksPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const webhooks = await listWebhooks(session.user.id);
  return (
    <div className="flex w-full max-w-3xl flex-col gap-8">
      <WebhookManager initialWebhooks={webhooks} />
    </div>
  );
}
