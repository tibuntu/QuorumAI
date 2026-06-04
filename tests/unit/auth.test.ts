import { describe, it, expect, afterAll } from "vitest";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

describe("auth backend", () => {
  const email = `t-${Date.now()}@example.com`;
  const password = "correct-horse-battery";

  afterAll(async () => {
    // Clean up test user created by this run
    await prisma.user.deleteMany({ where: { email } });
  });

  it("signs a user up and back in", async () => {
    const signUp = await auth.api.signUpEmail({
      body: { email, password, name: "Test User" },
    });
    expect(signUp.user.email).toBe(email);
    expect(signUp.token).toBeTruthy();

    const signIn = await auth.api.signInEmail({
      body: { email, password },
    });
    expect(signIn.user.email).toBe(email);
    expect(signIn.token).toBeTruthy();
  });

  it("defaults user role to 'member'", async () => {
    const dbUser = await prisma.user.findUnique({ where: { email } });
    expect(dbUser).not.toBeNull();
    expect(dbUser?.role).toBe("member");
  });
});
