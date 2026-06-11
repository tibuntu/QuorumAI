import { test, expect } from "@playwright/test";

test("per-type notification prefs persist", async ({ page }) => {
  const email = `pref-${Date.now()}-${Math.round(Math.random() * 1e6)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("name").fill("Pref User");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();
  await expect(page).toHaveURL(/\/app/);

  await page.goto("/app/settings/notifications");

  const commentEmail = page.getByTestId("pref-comment-email");
  await expect(commentEmail).toBeChecked(); // default on
  await expect(page.getByTestId("pref-resolve-email")).toBeDisabled(); // non-emailable
  await expect(page.getByTestId("pref-version-inApp")).toBeChecked(); // default on

  const saved = page.waitForResponse(
    (r) => r.url().includes("/api/settings/notifications") && r.request().method() === "PATCH",
  );
  await commentEmail.click();
  await expect(commentEmail).not.toBeChecked();
  await saved;

  await page.reload();
  await expect(page.getByTestId("pref-comment-email")).not.toBeChecked();
  await expect(page.getByTestId("pref-version-inApp")).toBeChecked(); // unrelated cell unchanged
});
