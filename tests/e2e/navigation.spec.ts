import { test, expect } from "@playwright/test";

test("nav reaches settings and inbox", async ({ page }) => {
  const email = `nav-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("Nav User");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/app\/settings\/notifications/);
  await expect(page.getByTestId("email-pref")).toBeVisible();

  // Settings sub-nav reaches API tokens.
  await page.getByRole("link", { name: "API tokens" }).click();
  await expect(page).toHaveURL(/\/app\/settings\/tokens/);
  await expect(page.getByLabel("token label")).toBeVisible();

  await page.getByRole("link", { name: "Documents" }).click();
  await expect(page).toHaveURL(/\/app$/);

  await page.getByTestId("inbox-link").click();
  await expect(page).toHaveURL(/\/app\/inbox/);
});

test("landing page shows for logged-out visitors", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Get started" })).toBeVisible();
});
