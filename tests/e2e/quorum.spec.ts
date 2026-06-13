import { test, expect, type Page } from "@playwright/test";

async function register(page: Page, name: string) {
  const email = `${name.toLowerCase()}-${Date.now()}-${Math.round(Math.random()*1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill(name);
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);
}

test("quorum threshold gates approval", async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const reviewerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const reviewer = await reviewerCtx.newPage();

  await register(owner, "Olive");
  await register(reviewer, "Remy");

  // Owner creates a doc requiring 2 approvals.
  await owner.goto("/app");
  await owner.getByLabel("title").fill("Quorum demo");
  await owner.getByLabel("markdown").fill("# Plan\n\nReview this.");
  await owner.getByLabel("required approvals").fill("2");
  await owner.getByRole("button", { name: "Create document" }).click();
  await expect(owner).toHaveURL(/\/app\/documents\//);
  const url = owner.url();
  await expect(owner.getByTestId("approval-progress")).toHaveText("0 of 2 approvals");

  // Reviewer opens the same doc (becomes a participant on access-grant) and approves.
  await reviewer.goto(url);
  // The Approve button is server-rendered; wait for the client component to hydrate
  // (it POSTs presence on mount) before clicking, or the click is a no-op against an
  // un-wired handler and the review never registers.
  await reviewer.waitForResponse(
    (r) => r.url().includes(`/presence`) && r.request().method() === "POST",
  );
  const approved = reviewer.waitForResponse(
    (r) => r.url().includes(`/reviews`) && r.request().method() === "POST",
  );
  await reviewer.getByRole("button", { name: "Approve" }).click();
  expect((await approved).ok()).toBeTruthy();
  // 1 of 2 → still Open.
  await expect(reviewer.getByTestId("doc-state")).toHaveText("Open");

  // Owner reloads to see the updated count, then lowers the threshold to 1.
  await owner.reload();
  await expect(owner.getByTestId("approval-progress")).toHaveText("1 of 2 approvals");
  await owner.getByTestId("required-approvals").fill("1");
  await owner.getByTestId("required-approvals").blur();
  await expect(owner.getByTestId("doc-state")).toHaveText("Approved");

  await ownerCtx.close();
  await reviewerCtx.close();
});
