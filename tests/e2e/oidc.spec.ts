// Default-state (no-OIDC) regression coverage. The Playwright webServer builds
// once with the ambient env, which has no OIDC_* / NEXT_PUBLIC_OIDC_ENABLED set,
// so these tests assert the password-only default. The OIDC-ENABLED path (visible
// SSO button + full sign-in via a mock IdP) is deferred — see the plan's Task 5
// coverage note. Config/gating/signup-disable are covered by the unit suite.
import { test, expect } from "@playwright/test";

test("login page has no SSO button by default; password form present", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: /sign in with sso/i })).toHaveCount(0);
  await expect(page.getByLabel("email")).toBeVisible();
  await expect(page.getByLabel("password")).toBeVisible();
  await expect(page.getByRole("button", { name: /^log in$/i })).toBeVisible();
});

test("register page shows the signup form by default (not the SSO notice)", async ({ page }) => {
  await page.goto("/register");
  await expect(page.getByLabel("name")).toBeVisible();
  await expect(page.getByRole("button", { name: /^sign up$/i })).toBeVisible();
  await expect(page.getByText(/sign-up is via sso/i)).toHaveCount(0);
});
