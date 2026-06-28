import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { baseUrl } from "@/lib/config";
import { prisma } from "@/lib/db";
import { isOidcConfigured, oidcPlugins } from "@/lib/oidc";
import { isRegistrationAllowed } from "@/lib/registration";

const trustedOrigins = [
  baseUrl(),
  ...(process.env.TRUSTED_ORIGINS?.split(",").map((o) => o.trim()) ?? []),
].filter((o): o is string => Boolean(o));

const oidcConfigured = isOidcConfigured();

// Match the better-auth Prisma adapter dialect to the active database, the same
// way lib/db.ts selects its driver adapter.
const dbProvider = /^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? "") ? "postgresql" : "sqlite";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: dbProvider }),
  secret: process.env.AUTH_SECRET,
  baseURL: baseUrl(),
  trustedOrigins,
  // Rate limiting is enabled in production by default. Allow the automated
  // test environment (which runs a production build) to opt out so the e2e
  // suite's burst of registrations isn't throttled. Production deployments
  // never set DISABLE_RATE_LIMIT, so they stay protected.
  // storage: "database" keeps the rate-limit counter shared across replicas — the
  // default in-memory store is per-process and bypassable behind a load balancer.
  rateLimit: { enabled: process.env.NODE_ENV === "production" && process.env.DISABLE_RATE_LIMIT !== "true", storage: "database" },
  // Self-service password signup is disabled under SSO so an attacker can't
  // pre-register an unverified email that a later OIDC sign-in would link into
  // (ADR-Security-000, D5a). Password LOGIN for existing users is unaffected.
  emailAndPassword: { enabled: true, disableSignUp: oidcConfigured },
  databaseHooks: {
    user: {
      create: {
        // Email allowlist (REGISTRATION_ALLOWLIST): the single choke point that stops
        // random account creation on a public instance. Fail-closed — an unset/empty
        // allowlist blocks all self-service registration; "*" opts back into open signup
        // (see lib/registration.ts). Read at call time so it stays env-stub-testable.
        // Also gates first-time OIDC users; this deploy is password-only so that's moot,
        // but a future OIDC operator must allowlist their IdP's email domain.
        before: async (user) => {
          if (!isRegistrationAllowed(user.email)) {
            throw new APIError("FORBIDDEN", {
              message: "Registration is by invitation only. Contact your administrator.",
            });
          }
        },
      },
    },
  },
  account: {
    accountLinking: {
      // Link an OIDC identity to an existing user on a matching email. Consensum
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
