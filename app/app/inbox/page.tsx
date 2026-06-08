import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import InboxList from "@/components/InboxList";

export default async function InboxPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <div className="flex w-full max-w-3xl flex-col gap-8">
      <InboxList />
    </div>
  );
}
