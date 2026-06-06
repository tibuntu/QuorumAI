import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const STEPS = [
  {
    step: "1",
    title: "Push the plan",
    body: "Your agent runs /push-plan and the proposal lands in Quorum as a reviewable document.",
  },
  {
    step: "2",
    title: "Review together",
    body: "Your team reads it, selects text to comment, threads discussion, and votes Approve or Request changes.",
  },
  {
    step: "3",
    title: "Pull feedback",
    body: "The agent runs /pull-feedback, receives consolidated decisions, and revises before writing any code.",
  },
];

export default async function Index() {
  const session = await getSession();
  if (session) redirect("/app");
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <span className="font-semibold text-foreground">◆ Quorum AI</span>
          <div className="flex items-center gap-2">
            <Link href="/login"><Button variant="ghost" size="sm">Log in</Button></Link>
            <Link href="/register"><Button size="sm">Sign up</Button></Link>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-6 py-24 text-center sm:py-32">
          <span className="rounded-full border border-border bg-primary-subtle px-3 py-1 text-sm font-medium text-primary">
            Plan review for the age of agents
          </span>
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Pull-request review, but for the plan — before the agent builds.
          </h1>
          <p className="max-w-xl text-lg text-muted">
            Your agent drafts a plan; your team reviews and refines it asynchronously; consolidated
            feedback flows back into the agent before a line of code is written.
          </p>
          <div className="flex gap-3">
            <Link href="/register"><Button>Get started</Button></Link>
            <Link href="/login"><Button variant="secondary">Log in</Button></Link>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-24">
          <div className="grid gap-4 sm:grid-cols-3">
            {STEPS.map((s) => (
              <Card key={s.step} className="flex flex-col gap-3 p-6">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-subtle text-sm font-semibold text-primary">
                  {s.step}
                </span>
                <h2 className="font-semibold text-foreground">{s.title}</h2>
                <p className="text-sm text-muted">{s.body}</p>
              </Card>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-6 py-6 text-sm text-muted sm:flex-row">
          <span>◆ Quorum AI — review the plan, then build.</span>
          <div className="flex gap-4">
            <Link href="/login" className="hover:text-foreground">Log in</Link>
            <Link href="/register" className="hover:text-foreground">Sign up</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
