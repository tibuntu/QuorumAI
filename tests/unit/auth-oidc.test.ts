import { describe, it, expect, vi, beforeEach } from "vitest";

// Re-import lib/auth with a fresh module registry so module-level env reads
// (oidcConfigured) re-evaluate. prisma is a globalThis singleton, so re-import
// reuses the same client.
async function freshAuth() {
  vi.resetModules();
  return (await import("@/lib/auth")).auth;
}

describe("auth account-linking policy (env-independent)", () => {
  it("links by IdP-verified email, not local-verified email", async () => {
    const auth = await freshAuth();
    expect(auth.options.account?.accountLinking).toMatchObject({
      enabled: true,
      requireLocalEmailVerified: false,
    });
  });

  it("does not trust the oidc provider (IdP email must be verified to link)", async () => {
    const auth = await freshAuth();
    const trustedProviders = (auth.options.account?.accountLinking as { trustedProviders?: string[] } | undefined)?.trustedProviders;
    expect(trustedProviders ?? []).not.toContain("oidc");
  });
});

describe("OIDC gating", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("registers no OIDC provider and keeps signup open by default", async () => {
    vi.stubEnv("OIDC_ISSUER", "");
    vi.stubEnv("OIDC_CLIENT_ID", "");
    vi.stubEnv("OIDC_CLIENT_SECRET", "");
    const auth = await freshAuth();
    expect(auth.options.plugins?.some((p) => p.id === "generic-oauth")).toBe(false);
    expect(auth.options.emailAndPassword?.disableSignUp).toBeFalsy();
  });

  it("registers the OIDC provider and disables signup when configured", async () => {
    vi.stubEnv("OIDC_ISSUER", "https://idp.example.com");
    vi.stubEnv("OIDC_CLIENT_ID", "quorum");
    vi.stubEnv("OIDC_CLIENT_SECRET", "shhh");
    const auth = await freshAuth();
    expect(auth.options.plugins?.some((p) => p.id === "generic-oauth")).toBe(true);
    expect(auth.options.emailAndPassword?.disableSignUp).toBe(true);
  });

  it("rejects self-service signup when OIDC is configured (D5a, server-side)", async () => {
    vi.stubEnv("OIDC_ISSUER", "https://idp.example.com");
    vi.stubEnv("OIDC_CLIENT_ID", "quorum");
    vi.stubEnv("OIDC_CLIENT_SECRET", "shhh");
    const auth = await freshAuth();
    await expect(
      auth.api.signUpEmail({
        body: { email: `gate-${Date.now()}@example.com`, password: "correct-horse-battery", name: "Gate" },
      }),
    ).rejects.toBeTruthy();
  });
});
