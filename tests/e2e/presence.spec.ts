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

// Instrument window.EventSource construction count BEFORE any app script runs.
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

test("presence roster shows both viewers and stays at two EventSources", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  await countEventSources(ctxA);
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  // User A registers and creates a document.
  await register(pageA, "Ada");
  await pageA.goto("/app");
  await pageA.getByLabel("title").fill("Presence demo");
  await pageA.getByLabel("markdown").fill("# Hello\n\nReview me together.");
  await pageA.getByRole("button", { name: "Create document" }).click();
  await expect(pageA).toHaveURL(/\/app\/documents\/[^/]+$/);
  const docUrl = pageA.url();

  // User B registers and opens the same document (link-grant adds them as participant).
  await register(pageB, "Grace");
  await pageB.goto(docUrl);
  await expect(pageB.getByTestId("doc-body")).toBeVisible();

  // Both rosters show two people, including both names.
  for (const page of [pageA, pageB]) {
    const stack = page.getByTestId("presence-roster");
    await expect(stack).toHaveAttribute("aria-label", /2 people viewing/);
    await expect(stack.locator('[data-user-name*="Ada"]')).toHaveCount(1);
    await expect(stack.locator('[data-user-name*="Grace"]')).toHaveCount(1);
  }

  // Exactly two EventSource connections in A's tab (document + notifications).
  const esCount = await pageA.evaluate(() => (window as unknown as { __esCount: number }).__esCount);
  expect(esCount).toBe(2);

  // User B leaves; A's roster drops to one within the TTL window.
  await ctxB.close();
  await expect(pageA.getByTestId("presence-roster")).toHaveAttribute("aria-label", /1 person viewing/, {
    timeout: 10_000,
  });

  await ctxA.close();
});
