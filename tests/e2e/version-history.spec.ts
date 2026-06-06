import { test, expect, type Page } from "@playwright/test";

async function register(page: Page): Promise<void> {
  const email = `vh-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("Historian");
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

async function setEditorText(page: Page, text: string) {
  const editor = page.getByTestId("editor").locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Delete");
  await editor.type(text);
}

test("versions API: participant 200, unauthenticated 401, absent doc 404", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await register(pageA);
  const url = await createDoc(pageA, "Audited Plan", "The cloud setup needs review.");
  const id = url.split("/app/documents/")[1];

  // Owner (participant) gets the version list.
  const ok = await pageA.request.get(`/api/documents/${id}/versions`);
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(Array.isArray(body.versions)).toBe(true);
  expect(body.versions.length).toBeGreaterThanOrEqual(1);

  // Unauthenticated (fresh context, no session) → 401.
  const ctxAnon = await browser.newContext();
  const pageAnon = await ctxAnon.newPage();
  const unauth = await pageAnon.request.get(`/api/documents/${id}/versions`);
  expect(unauth.status()).toBe(401);

  // Authenticated request for a non-existent doc → 404 (no existence leak).
  const absent = await pageA.request.get(`/api/documents/does-not-exist/versions`);
  expect(absent.status()).toBe(404);

  await ctxAnon.close();
  await ctxA.close();
});

async function editAndSave(page: Page, text: string) {
  await page.getByRole("button", { name: "Edit" }).click();
  await setEditorText(page, text);
  await page.getByRole("button", { name: "Save" }).click();
  // Successful save refetches and returns to review mode (Edit button reappears).
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
}

test("history lists versions and diffs the selected pair", async ({ page }) => {
  await register(page);
  await createDoc(page, "History Plan", "The quick brown fox jumps over the lazy dog.");
  await editAndSave(page, "The quick brown wolf jumps over the lazy dog.");
  await editAndSave(page, "The quick brown wolf leaps over the lazy dog.");

  await page.getByTestId("history-link").click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(page.getByTestId("from-select")).toHaveValue("2");
  await expect(page.getByTestId("to-select")).toHaveValue("3");
  await expect(page.getByTestId("diff")).toBeVisible();

  await page.getByTestId("from-select").selectOption("1");
  await expect(page).toHaveURL(/from=1&to=3/);
  await expect(page.getByTestId("diff")).toBeVisible();
});
