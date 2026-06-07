import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/db";
import { isOidcConfigured, oidcPlugins } from "@/lib/oidc";

const trustedOrigins = [
  process.env.BETTER_AUTH_URL,
  ...(process.env.TRUSTED_ORIGINS?.split(",").map((o) => o.trim()) ?? []),
].filter((o): o is string => Boolean(o));

const oidcConfigured = isOidcConfigured();

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "sqlite" }),
  trustedOrigins,
  // Rate limiting is enabled in production by default. Allow the automated
  // test environment (which runs a production build) to opt out so the e2e
  // suite's burst of registrations isn't throttled. Production deployments
  // never set DISABLE_RATE_LIMIT, so they stay protected.
  rateLimit: { enabled: process.env.NODE_ENV === "production" && process.env.DISABLE_RATE_LIMIT !== "true" },
  // Self-service password signup is disabled under SSO so an attacker can't
  // pre-register an unverified email that a later OIDC sign-in would link into
  // (ADR-Security-000, D5a). Password LOGIN for existing users is unaffected.
  emailAndPassword: { enabled: true, disableSignUp: oidcConfigured },
  account: {
    accountLinking: {
      // Link an OIDC identity to an existing user on a matching email. Quorum
      // has no local email-verification flow, so requireLocalEmailVerified must
      // be false or linking would never fire. Safety comes from the IdP side:
      // "oidc" is intentionally NOT in trustedProviders, so better-auth still
      // requires the IdP to mark the email verified before linking
      // (ADR-Security-000, D4/D5).
      enabled: true,
      requireLocalEmailVerified: false,
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "member",
        input: false,
      },
    },
  },
  plugins: [...oidcPlugins(), nextCookies()],
});
