import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { listTokens } from "@/lib/tokens";
import TokenManager from "@/components/TokenManager";

export default async function TokensPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const tokens = await listTokens(session.user.id);
  return (
    <div className="mx-auto mt-12 flex w-full max-w-3xl flex-col gap-8 px-4">
      <TokenManager initialTokens={tokens} baseUrl={process.env.BETTER_AUTH_URL ?? ""} />
    </div>
  );
}
