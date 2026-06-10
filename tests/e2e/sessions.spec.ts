import { test, expect, type Page, type BrowserContext } from "@playwright/test";

async function register(page: Page, name: string): Promise<void> {
  const email = `${name.toLowerCase()}-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill(name);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);
}

async function countEventSources(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const w = window as unknown as { __esCount: number; EventSource: typeof EventSource };
    w.__esCount = 0;
    const Native = w.EventSource;
    class Counting extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        w.__esCount += 1;
      }
    }
    w.EventSource = Counting as unknown as typeof EventSource;
  });
}

test("review session lifecycle across two participants", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  await countEventSources(ctxA);
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await register(pageA, "Ada");
  await pageA.goto("/app");
  await pageA.getByLabel("title").fill("Session demo");
  await pageA.getByLabel("markdown").fill("# Hello\n\nReview me together.");
  await pageA.getByRole("button", { name: "Create document" }).click();
  await expect(pageA).toHaveURL(/\/app\/documents\/[^/]+$/);
  const docUrl = pageA.url();

  await register(pageB, "Grace");
  await pageB.goto(docUrl);
  await expect(pageB.getByTestId("doc-body")).toBeVisible();

  // A starts a session.
  await pageA.getByTestId("start-session").click();
  await expect(pageA.getByTestId("session-banner")).toContainText("You're leading");
  await expect(pageB.getByTestId("session-banner")).toContainText("Ada");
  await expect(pageB.getByTestId("join-session")).toBeVisible();

  // B joins -> both show 2 participants.
  await pageB.getByTestId("join-session").click();
  await expect(pageA.getByTestId("session-participant-count")).toHaveText("2");
  await expect(pageB.getByTestId("session-participant-count")).toHaveText("2");
  await expect(pageB.getByTestId("leave-session")).toBeVisible();

  // Exactly two EventSources in A's tab (document + notifications).
  const esCount = await pageA.evaluate(() => (window as unknown as { __esCount: number }).__esCount);
  expect(esCount).toBe(2);

  // A ends the session -> both banners clear.
  await pageA.getByTestId("end-session").click();
  await expect(pageA.getByTestId("session-banner")).toHaveCount(0);
  await expect(pageB.getByTestId("session-banner")).toHaveCount(0);
  await expect(pageA.getByTestId("start-session")).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});

test("session auto-ends when the leader disconnects", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await register(pageA, "Ada");
  await pageA.goto("/app");
  await pageA.getByLabel("title").fill("Leader drop");
  await pageA.getByLabel("markdown").fill("# Drop test");
  await pageA.getByRole("button", { name: "Create document" }).click();
  await expect(pageA).toHaveURL(/\/app\/documents\/[^/]+$/);
  const docUrl = pageA.url();

  await register(pageB, "Grace");
  await pageB.goto(docUrl);
  await pageA.getByTestId("start-session").click();
  await pageB.getByTestId("join-session").click();
  await expect(pageB.getByTestId("session-banner")).toBeVisible();

  // Leader's tab closes -> B's banner clears within the presence-TTL + sweep window.
  await ctxA.close();
  await expect(pageB.getByTestId("session-banner")).toHaveCount(0, { timeout: 30_000 });

  await ctxB.close();
});
