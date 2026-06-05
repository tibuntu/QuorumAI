import { test, expect, type Page } from "@playwright/test";

async function register(page: Page): Promise<string> {
  const email = `int-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("Integrator");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);
  return email;
}

test("machine API: token → push plan → feedback", async ({ page, request }) => {
  await register(page);
  await page.goto("/app/settings/tokens");
  await page.getByLabel("token label").fill("ci");
  await page.getByRole("button", { name: "Create token" }).click();
  const token = await page.getByTestId("new-token").inputValue();
  expect(token.startsWith("qai_")).toBe(true);

  const post = await request.post("/api/plans", {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: "Agent Plan", markdown: "The cloud setup needs review." },
  });
  expect(post.status()).toBe(201);
  const { id, reviewUrl } = await post.json();
  expect(reviewUrl).toContain(`/app/documents/${id}`);

  const fb = await request.get(`/api/plans/${id}/feedback`, { headers: { Authorization: `Bearer ${token}` } });
  expect(fb.status()).toBe(200);
  expect((await fb.json()).decision).toBe("pending");

  const unauth = await request.get(`/api/plans/${id}/feedback`);
  expect(unauth.status()).toBe(401);
});

test("notifications: comment notifies the plan owner", async ({ browser }) => {
  // Owner A creates a plan via the UI.
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await register(pageA);
  await pageA.getByLabel("title").fill("Notify Plan");
  await pageA.getByLabel("markdown").fill("Shared content needing review.");
  await pageA.getByRole("button", { name: "Create document" }).click();
  await expect(pageA).toHaveURL(/\/app\/documents\//);
  const url = pageA.url();

  // Reviewer B comments on it.
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await register(pageB);
  await pageB.goto(url);
  await pageB.getByTestId("doc-body").getByText("Shared content").first().selectText();
  await pageB.getByLabel("comment").fill("a question from B");
  await pageB.getByRole("button", { name: "Comment" }).click();
  await expect(pageB.getByTestId("thread")).toContainText("a question from B");

  // A sees an inbox notification.
  await pageA.goto("/app/inbox");
  await expect(pageA.getByTestId("notification").first()).toContainText("Notify Plan");

  await ctxA.close();
  await ctxB.close();
});
