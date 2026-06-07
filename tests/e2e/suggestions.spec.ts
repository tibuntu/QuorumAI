import { test, expect, type Page } from "@playwright/test";

async function register(page: Page): Promise<void> {
  const email = `sug-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("User");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);
}

async function createDoc(page: Page, title: string, markdown: string): Promise<string> {
  await page.goto("/app");
  await page.getByLabel("title").fill(title);
  await page.getByLabel("markdown").fill(markdown);
  await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).toHaveURL(/\/app\/documents\//);
  return page.url();
}

test("suggestion: propose → owner accept → new version, resolved, approval dismissed, provenance; non-owner apply 403", async ({ browser }) => {
  // Owner A creates and approves a doc.
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await register(pageA);
  const urlA = await createDoc(pageA, "Cloud Plan", "The cloud setup needs review.");
  const idA = urlA.split("/app/documents/")[1];
  await pageA.getByRole("button", { name: "Approve" }).click();
  await expect(pageA.getByTestId("doc-state")).toHaveText("Approved");

  // Reviewer B opens A's doc by URL (link-grant auto-join).
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await register(pageB);
  await pageB.goto(urlA);
  await expect(pageB.getByTestId("doc-body")).toContainText("cloud setup");

  // B selects "cloud setup", proposes a suggestion of "k8s cluster".
  // selectText fires the selectionchange listener (attached on hydration) that
  // renders the selection card. Under parallel load hydration may lag the
  // visible (server-rendered) text, so re-select until the card appears.
  const suggestEdit = pageB.getByRole("button", { name: "Suggest edit" });
  await expect(async () => {
    await pageB.getByTestId("doc-body").getByText("cloud setup").first().selectText();
    await expect(suggestEdit).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await suggestEdit.click();
  await pageB.getByLabel("proposed text").fill("k8s cluster");
  await pageB.getByRole("button", { name: "Suggest" }).click();
  await expect(pageB.getByTestId("suggestion")).toContainText("k8s cluster");

  // B (non-owner) cannot apply the suggestion: POST .../apply → 403.
  const detailB = await pageB.request.get(`/api/documents/${idA}`);
  expect(detailB.status()).toBe(200);
  const { document: docB } = await detailB.json();
  const annId = docB.annotations[0].id;
  expect(typeof annId).toBe("string");
  expect(annId.length).toBeGreaterThan(0);
  const applyB = await pageB.request.post(`/api/annotations/${annId}/apply`, {
    data: { baseVersionNumber: 1 },
  });
  expect(applyB.status()).toBe(403);

  // Owner A sees the suggestion propagate via SSE and accepts it.
  await expect(pageA.getByTestId("suggestion")).toContainText("k8s cluster", { timeout: 10_000 });
  await pageA.getByRole("button", { name: "Accept" }).click();

  // The accepted suggestion produces a new version with the proposed text,
  // dismisses the prior approval, and is marked applied.
  await expect(pageA.getByTestId("doc-body")).toContainText("k8s cluster", { timeout: 10_000 });
  await expect(pageA.getByTestId("doc-state")).not.toHaveText("Approved");
  await expect(pageA.getByTestId("doc-state")).toHaveText("Open");
  await expect(pageA.getByTestId("suggestion")).toContainText("Applied as v2");

  // Provenance: the annotation records the version it was applied in and is resolved.
  const detailA = await pageA.request.get(`/api/documents/${idA}`);
  expect(detailA.status()).toBe(200);
  const { document: docA } = await detailA.json();
  const ann = docA.annotations[0];
  expect(ann.appliedInVersion.versionNumber).toBe(2);
  expect(ann.threadStatus).toBe("RESOLVED");

  await ctxA.close();
  await ctxB.close();
});
