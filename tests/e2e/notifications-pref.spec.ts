import { test, expect } from "@playwright/test";

test("user can toggle email notifications and it persists", async ({ page }) => {
  const email = `pref-${Date.now()}@example.com`;

  // Register (mirrors tests/e2e/auth.spec.ts).
  await page.goto("/register");
  await page.getByLabel("name").fill("Pref User");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);

  await page.goto("/app/settings/notifications");
  const box = page.getByTestId("email-pref");
  await expect(box).toBeChecked(); // default on
  await box.click();
  await expect(box).not.toBeChecked();

  await page.reload();
  await expect(page.getByTestId("email-pref")).not.toBeChecked();
});
