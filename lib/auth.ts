import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/db";

const trustedOrigins = [
  process.env.BETTER_AUTH_URL,
  ...(process.env.TRUSTED_ORIGINS?.split(",").map((o) => o.trim()) ?? []),
].filter((o): o is string => Boolean(o));

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "sqlite" }),
  trustedOrigins,
  // Rate limiting is enabled in production by default. Allow the automated
  // test environment (which runs a production build) to opt out so the e2e
  // suite's burst of registrations isn't throttled. Production deployments
  // never set DISABLE_RATE_LIMIT, so they stay protected.
  rateLimit: { enabled: process.env.NODE_ENV === "production" && process.env.DISABLE_RATE_LIMIT !== "true" },
  emailAndPassword: { enabled: true },
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
  plugins: [nextCookies()],
});
