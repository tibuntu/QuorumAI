import { test, expect } from "@playwright/test";

test("user can toggle email notifications and it persists", async ({ page }) => {
  const email = `pref-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;

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
  // Wait for the PATCH to land before reloading — reload aborts in-flight saves.
  const saved = page.waitForResponse(
    (r) => r.url().includes("/api/settings/notifications") && r.request().method() === "PATCH",
  );
  await box.click();
  await expect(box).not.toBeChecked();
  await saved;

  await page.reload();
  await expect(page.getByTestId("email-pref")).not.toBeChecked();
});
