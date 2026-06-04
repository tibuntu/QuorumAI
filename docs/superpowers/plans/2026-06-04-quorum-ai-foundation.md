# Quorum AI — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running, self-hostable Next.js app you can register/log into, with the complete M1 database schema and an authenticated app shell — the base every later feature builds on.

**Architecture:** A single Next.js 15 (App Router) project. Persistence is SQLite via Prisma; authentication is better-auth (email+password, DB-backed sessions) which owns its own auth tables and is extended with a `role` field. Our domain models (Document, DocumentVersion, Annotation, Comment, Review, ApiToken) are added alongside the auth tables in one schema. A minimal authenticated shell (register/login/home/logout + a route guard) proves the stack end-to-end.

**Tech Stack:** Next.js 15 (App Router, `output: "standalone"`), TypeScript, pnpm, Prisma 6 + SQLite (WAL), better-auth, Tailwind CSS v4, Vitest (unit/integration), Playwright (e2e).

**Scope note:** This is plan 1 of 3 for M1. It deliberately stops at "authenticated shell + schema." The review-core features (annotation, comments, verdicts, versioning) and the Claude Code integration + Docker packaging are separate plans, authored against this codebase once it exists.

**Conventions for every commit in this plan:** plain commit messages, **no `Co-Authored-By` / AI attribution trailer** (standing user preference).

---

### Task 0: Project scaffold & tooling

**Goal:** A buildable Next.js 15 + TypeScript + Tailwind project with Vitest and Playwright wired up, merged into the existing repo (README, docs/, .gitignore preserved).

**Files:**
- Create (generated): `package.json`, `next.config.ts`, `tsconfig.json`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `postcss.config.mjs`, `eslint.config.mjs`
- Create: `vitest.config.ts`, `playwright.config.ts`, `tests/unit/smoke.test.ts`, `.env.example`
- Modify: `next.config.ts` (add `output: "standalone"`), `package.json` (scripts)

**Acceptance Criteria:**
- [ ] `pnpm install` completes; `pnpm build` produces a standalone build with no type errors
- [ ] `pnpm test:unit` runs Vitest and the smoke test passes
- [ ] `pnpm exec playwright --version` resolves (browsers installable)
- [ ] Existing `README.md`, `docs/`, `.gitignore` are intact

**Verify:** `pnpm build && pnpm test:unit` → build succeeds, `1 passed`.

**Steps:**

- [ ] **Step 1: Scaffold Next.js into a temp dir, then merge** (avoids create-next-app's non-empty-dir refusal over `docs/`)

```bash
pnpm dlx create-next-app@latest .scaffold-tmp \
  --typescript --eslint --app --tailwind \
  --no-src-dir --import-alias "@/*" --use-pnpm
# move generated files into the repo root without clobbering existing tracked files
cp -R .scaffold-tmp/. .
# keep our own .gitignore and README; remove the generated duplicates if copied
git checkout -- .gitignore README.md 2>/dev/null || true
rm -rf .scaffold-tmp
```

- [ ] **Step 2: Enable standalone output**

Edit `next.config.ts` to:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 3: Add dev tooling**

```bash
pnpm add -D vitest @vitest/coverage-v8 @playwright/test
pnpm exec playwright install --with-deps chromium
```

- [ ] **Step 4: Configure scripts in `package.json`**

Set the `scripts` block to:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test:unit": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 5: Add `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, ".") } },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
```

- [ ] **Step 6: Add `playwright.config.ts`** (boots the app for e2e)

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "pnpm build && pnpm start",
    url: "http://localhost:3000",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
});
```

- [ ] **Step 7: Write the smoke test** `tests/unit/smoke.test.ts`

```ts
import { describe, it, expect } from "vitest";

describe("smoke", () => {
  it("runs the test toolchain", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 8: Add `.env.example`**

```bash
# Database
DATABASE_URL="file:./data/app.db"

# better-auth
BETTER_AUTH_SECRET="change-me-to-a-32+char-random-string"
BETTER_AUTH_URL="http://localhost:3000"
```

- [ ] **Step 9: Verify build + tests, then commit**

```bash
pnpm build
pnpm test:unit
git add -A
git commit -m "chore: scaffold Next.js app with Vitest and Playwright"
```

Expected: build succeeds; Vitest reports `1 passed`.

---

### Task 1: Persistence + authentication backend (Prisma, SQLite/WAL, better-auth)

**Goal:** SQLite persistence via Prisma with WAL enabled, plus a working better-auth backend (email+password, DB sessions) whose auth tables are generated into the schema — verified by server-side sign-up + sign-in.

**Files:**
- Create: `prisma/schema.prisma` (auth tables, generated + `role` field), `lib/db.ts`, `lib/auth.ts`, `lib/auth-client.ts`, `app/api/auth/[...all]/route.ts`
- Create: `tests/unit/auth.test.ts`
- Modify: `package.json` (add `prisma`, `@better-auth/cli` devDeps; `db:migrate`, `postinstall` scripts)

**Acceptance Criteria:**
- [ ] `prisma migrate dev` creates `data/app.db` with the better-auth tables (`user`, `session`, `account`, `verification`)
- [ ] The SQLite file is in WAL mode (`data/app.db-wal` appears after a write)
- [ ] A test can `auth.api.signUpEmail(...)` then `auth.api.signInEmail(...)` and receive a session
- [ ] `user.role` defaults to `"member"`

**Verify:** `pnpm test:unit -- tests/unit/auth.test.ts` → sign-up + sign-in test passes.

**Steps:**

- [ ] **Step 1: Install Prisma, better-auth, and the SQLite driver**

```bash
pnpm add @prisma/client better-auth better-sqlite3
pnpm add -D prisma @better-auth/cli @types/better-sqlite3
mkdir -p data
pnpm dlx prisma init --datasource-provider sqlite
```

- [ ] **Step 2: Set the Prisma generator/datasource** in `prisma/schema.prisma` (replace the generated header)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}
```

- [ ] **Step 3: Create the Prisma client singleton with WAL** `lib/db.ts`

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Enable WAL once per process for concurrent readers; safe to run repeatedly.
prisma.$executeRawUnsafe("PRAGMA journal_mode = WAL;").catch(() => {});
```

- [ ] **Step 4: Configure better-auth** `lib/auth.ts`

```ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { prisma } from "@/lib/db";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "sqlite" }),
  emailAndPassword: { enabled: true },
  user: {
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "member", input: false },
    },
  },
  plugins: [nextCookies()],
});
```

- [ ] **Step 5: Generate better-auth's Prisma models into the schema**

```bash
pnpm dlx @better-auth/cli@latest generate --config lib/auth.ts --output prisma/schema.prisma -y
```

Expected: `prisma/schema.prisma` now contains `model User`, `model Session`, `model Account`, `model Verification` with a `role String?` field on `User`.

- [ ] **Step 6: Create the auth route handler** `app/api/auth/[...all]/route.ts`

```ts
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { POST, GET } = toNextJsHandler(auth);
```

- [ ] **Step 7: Create the client helper** `lib/auth-client.ts`

```ts
"use client";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
export const { signIn, signUp, signOut, useSession } = authClient;
```

- [ ] **Step 8: Run the first migration**

```bash
pnpm dlx prisma migrate dev --name init_auth
```

Expected: `data/app.db` created; migration applied.

- [ ] **Step 9: Add the failing auth test** `tests/unit/auth.test.ts`

```ts
import { describe, it, expect, beforeAll } from "vitest";
import { auth } from "@/lib/auth";

describe("auth backend", () => {
  const email = `t-${Date.now()}@example.com`;
  const password = "correct-horse-battery";

  it("signs a user up and back in", async () => {
    const signUp = await auth.api.signUpEmail({
      body: { email, password, name: "Test User" },
    });
    expect(signUp.user.email).toBe(email);
    expect((signUp.user as { role?: string }).role).toBe("member");

    const signIn = await auth.api.signInEmail({ body: { email, password } });
    expect(signIn.user.email).toBe(email);
    expect(signIn.token).toBeTruthy();
  });
});
```

- [ ] **Step 10: Run the test (red→green)**

```bash
pnpm test:unit -- tests/unit/auth.test.ts
```

Expected: passes. If it fails with "no such table", re-run Step 8 (migration not applied). If `role` is undefined, re-run Step 5 then Step 8.

- [ ] **Step 11: Add scripts and commit**

Add to `package.json` scripts: `"db:migrate": "prisma migrate dev"`, `"db:deploy": "prisma migrate deploy"`, `"postinstall": "prisma generate"`.

```bash
git add -A
git commit -m "feat: add Prisma/SQLite persistence and better-auth backend"
```

---

### Task 2: Domain schema (documents, versions, annotations, comments, reviews, API tokens)

**Goal:** The complete M1 domain data model exists and round-trips through Prisma, with foreign keys to the better-auth `User`.

**Files:**
- Modify: `prisma/schema.prisma` (append domain models + enums)
- Create: `tests/unit/schema.test.ts`
- Create (migration): `prisma/migrations/*_domain_models/`

**Acceptance Criteria:**
- [ ] Migration applies cleanly with all domain tables + enums
- [ ] A test creates a `User` → `Document` → `DocumentVersion` → `Annotation` → `Comment` chain and reads it back
- [ ] Deleting a `Document` cascades to its versions, annotations, and comments

**Verify:** `pnpm test:unit -- tests/unit/schema.test.ts` → passes.

**Steps:**

- [ ] **Step 1: Append domain models to `prisma/schema.prisma`**

```prisma
enum DocumentState {
  DRAFT
  OPEN
  CHANGES_REQUESTED
  APPROVED
  CLOSED
}

enum DocumentSource {
  WEB
  CLAUDE_CODE
}

enum AnnotationKind {
  COMMENT
  SUGGESTION
}

enum AnchorStatus {
  ACTIVE
  MOVED
  ORPHANED
}

enum ThreadStatus {
  OPEN
  RESOLVED
}

enum ReviewVerdict {
  APPROVE
  REQUEST_CHANGES
  COMMENT
}

model ApiToken {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique
  label      String
  lastUsedAt DateTime?
  createdAt  DateTime  @default(now())

  @@index([userId])
}

model Document {
  id               String           @id @default(cuid())
  title            String
  ownerId          String
  owner            User             @relation("DocumentOwner", fields: [ownerId], references: [id], onDelete: Cascade)
  state            DocumentState    @default(DRAFT)
  requiredApprovals Int             @default(1)
  source           DocumentSource   @default(WEB)
  agentContext     String?
  currentVersionId String?          @unique
  currentVersion   DocumentVersion? @relation("CurrentVersion", fields: [currentVersionId], references: [id])
  createdAt        DateTime         @default(now())
  updatedAt        DateTime         @updatedAt

  versions    DocumentVersion[] @relation("DocumentVersions")
  annotations Annotation[]
  reviews     Review[]

  @@index([ownerId])
  @@index([state])
}

model DocumentVersion {
  id            String   @id @default(cuid())
  documentId    String
  document      Document @relation("DocumentVersions", fields: [documentId], references: [id], onDelete: Cascade)
  versionNumber Int
  markdown      String
  contentHash   String
  createdById   String
  createdBy     User     @relation(fields: [createdById], references: [id])
  createdAt     DateTime @default(now())

  currentFor Document? @relation("CurrentVersion")

  @@unique([documentId, versionNumber])
  @@index([documentId])
}

model Annotation {
  id              String         @id @default(cuid())
  documentId      String
  document        Document       @relation(fields: [documentId], references: [id], onDelete: Cascade)
  createdOnVersionId String
  kind            AnnotationKind @default(COMMENT)
  anchorExact     String?
  anchorPrefix    String?
  anchorSuffix    String?
  startOffset     Int?
  endOffset       Int?
  status          AnchorStatus   @default(ACTIVE)
  threadStatus    ThreadStatus   @default(OPEN)
  authorId        String
  author          User           @relation(fields: [authorId], references: [id])
  createdAt       DateTime       @default(now())

  comments Comment[]

  @@index([documentId])
}

model Comment {
  id           String     @id @default(cuid())
  annotationId String
  annotation   Annotation @relation(fields: [annotationId], references: [id], onDelete: Cascade)
  authorId     String
  author       User       @relation(fields: [authorId], references: [id])
  body         String
  createdAt    DateTime   @default(now())

  @@index([annotationId])
}

model Review {
  id         String        @id @default(cuid())
  documentId String
  document   Document      @relation(fields: [documentId], references: [id], onDelete: Cascade)
  reviewerId String
  reviewer   User          @relation(fields: [reviewerId], references: [id])
  verdict    ReviewVerdict
  onVersionId String
  dismissed  Boolean       @default(false)
  createdAt  DateTime      @default(now())

  @@index([documentId])
}
```

- [ ] **Step 2: Add the back-relations to the better-auth `User` model**

In `model User { ... }` add these relation fields (the scalar/auth fields generated in Task 1 stay as-is):

```prisma
  apiTokens        ApiToken[]
  ownedDocuments   Document[]        @relation("DocumentOwner")
  authoredVersions DocumentVersion[]
  annotations      Annotation[]
  comments         Comment[]
  reviews          Review[]
```

- [ ] **Step 3: Create and apply the migration**

```bash
pnpm dlx prisma migrate dev --name domain_models
```

Expected: new tables `ApiToken`, `Document`, `DocumentVersion`, `Annotation`, `Comment`, `Review`.

- [ ] **Step 4: Write the round-trip + cascade test** `tests/unit/schema.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";

describe("domain schema", () => {
  it("round-trips a document chain and cascades on delete", async () => {
    const user = await prisma.user.create({
      data: { id: `u-${Date.now()}`, name: "Owner", email: `o-${Date.now()}@ex.com`, emailVerified: false },
    });

    const doc = await prisma.document.create({
      data: { title: "Plan A", ownerId: user.id },
    });
    const v1 = await prisma.documentVersion.create({
      data: { documentId: doc.id, versionNumber: 1, markdown: "# Hi", contentHash: "abc", createdById: user.id },
    });
    await prisma.document.update({ where: { id: doc.id }, data: { currentVersionId: v1.id } });

    const ann = await prisma.annotation.create({
      data: { documentId: doc.id, createdOnVersionId: v1.id, authorId: user.id, anchorExact: "Hi" },
    });
    await prisma.comment.create({
      data: { annotationId: ann.id, authorId: user.id, body: "looks good" },
    });

    const loaded = await prisma.document.findUnique({
      where: { id: doc.id },
      include: { versions: true, annotations: { include: { comments: true } } },
    });
    expect(loaded?.versions).toHaveLength(1);
    expect(loaded?.annotations[0].comments[0].body).toBe("looks good");

    await prisma.document.delete({ where: { id: doc.id } });
    expect(await prisma.annotation.findUnique({ where: { id: ann.id } })).toBeNull();
  });
});
```

- [ ] **Step 5: Run the test, then commit**

```bash
pnpm test:unit -- tests/unit/schema.test.ts
git add -A
git commit -m "feat: add domain schema for documents, annotations, comments, reviews"
```

Expected: passes.

---

### Task 3: Auth UI + authenticated shell + route guard

**Goal:** Working `/register` and `/login` pages, a home page that shows the signed-in user and a sign-out button, and a guard that redirects unauthenticated users to `/login` — verified end-to-end with Playwright.

**Files:**
- Create: `app/login/page.tsx`, `app/register/page.tsx`, `app/(app)/layout.tsx`, `app/(app)/page.tsx`, `components/SignOutButton.tsx`, `middleware.ts`, `lib/session.ts`
- Modify: `app/page.tsx` (redirect to `/login` or `/app`)
- Create: `tests/e2e/auth.spec.ts`

**Acceptance Criteria:**
- [ ] Visiting a protected route while signed out redirects to `/login`
- [ ] Registering creates an account and lands on the authenticated home showing the user's email
- [ ] Sign out returns to `/login` and the protected route is blocked again
- [ ] Playwright e2e covers register → home → logout

**Verify:** `pnpm test:e2e -- tests/e2e/auth.spec.ts` → 1 passed.

**Steps:**

- [ ] **Step 1: Server-side session helper** `lib/session.ts`

```ts
import { auth } from "@/lib/auth";
import { headers } from "next/headers";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}
```

- [ ] **Step 2: Route guard** `middleware.ts` (cookie presence check; full check happens server-side)

```ts
import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export function middleware(request: NextRequest) {
  const session = getSessionCookie(request);
  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*"],
};
```

- [ ] **Step 3: Register page** `app/register/page.tsx`

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signUp } from "@/lib/auth-client";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { error } = await signUp.email({ email, password, name });
    if (error) return setError(error.message ?? "Sign up failed");
    router.push("/app");
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto mt-24 flex w-80 flex-col gap-3">
      <h1 className="text-xl font-semibold">Create your account</h1>
      <input aria-label="name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="border p-2" />
      <input aria-label="email" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="border p-2" />
      <input aria-label="password" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="border p-2" />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="bg-black p-2 text-white">Sign up</button>
      <a href="/login" className="text-sm underline">Already have an account? Log in</a>
    </form>
  );
}
```

- [ ] **Step 4: Login page** `app/login/page.tsx`

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const { error } = await signIn.email({ email, password });
    if (error) return setError(error.message ?? "Login failed");
    router.push("/app");
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto mt-24 flex w-80 flex-col gap-3">
      <h1 className="text-xl font-semibold">Log in</h1>
      <input aria-label="email" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className="border p-2" />
      <input aria-label="password" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} className="border p-2" />
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button type="submit" className="bg-black p-2 text-white">Log in</button>
      <a href="/register" className="text-sm underline">Need an account? Sign up</a>
    </form>
  );
}
```

- [ ] **Step 5: Sign-out button** `components/SignOutButton.tsx`

```tsx
"use client";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await signOut();
        router.push("/login");
      }}
      className="text-sm underline"
    >
      Sign out
    </button>
  );
}
```

- [ ] **Step 6: Authenticated layout + home** `app/(app)/layout.tsx` and `app/(app)/page.tsx`

`app/(app)/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { SignOutButton } from "@/components/SignOutButton";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b p-4">
        <span className="font-semibold">Quorum AI</span>
        <div className="flex items-center gap-4 text-sm">
          <span data-testid="current-user">{session.user.email}</span>
          <SignOutButton />
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
```

`app/(app)/page.tsx`:

```tsx
export default function Home() {
  return <p>Welcome. Documents will live here.</p>;
}
```

> Note: the `/app` URL is served by the `(app)` route group via the `app/(app)/page.tsx` file only if a route segment exists. Create the segment by adding `app/(app)` as a group AND ensuring the home route is `/app`: rename to `app/app/page.tsx` + `app/app/layout.tsx` instead of a route group if you want the literal `/app` path. Use literal `app/app/` so `middleware.ts` matcher `"/app/:path*"` applies.

- [ ] **Step 7: Root redirect** `app/page.tsx`

```tsx
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function Index() {
  const session = await getSession();
  redirect(session ? "/app" : "/login");
}
```

- [ ] **Step 8: Write the e2e test** `tests/e2e/auth.spec.ts`

```ts
import { test, expect } from "@playwright/test";

test("register, see home, logout, blocked again", async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/register");
  await page.getByLabel("name").fill("E2E User");
  await page.getByLabel("email").fill(email);
  await page.getByLabel("password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Sign up" }).click();

  await expect(page).toHaveURL(/\/app/);
  await expect(page.getByTestId("current-user")).toHaveText(email);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 9: Run e2e, then commit**

```bash
pnpm test:e2e -- tests/e2e/auth.spec.ts
git add -A
git commit -m "feat: add auth UI, authenticated shell, and route guard"
```

Expected: `1 passed`.

---

## Self-review

- **Spec coverage (Foundation slice):** scaffold ✓ (T0), SQLite+WAL+Prisma ✓ (T1), better-auth email+password + DB sessions + `role` ✓ (T1), full M1 domain schema ✓ (T2), auth UI + guard + authenticated shell ✓ (T3). Review-core, integration, and Docker are explicitly out of this plan (separate plans).
- **Placeholders:** none — every code step contains the actual file content; tooling steps use real CLI commands. The one judgment call (route group vs literal `/app`) is called out with the concrete resolution (use literal `app/app/`).
- **Type/name consistency:** `prisma` client singleton name, `auth` export, `getSession()`, `signIn/signUp/signOut` client exports, `data-testid="current-user"`, and the `/app` protected path are used consistently across tasks. Domain field names match the spec's data model.

## Notes for the next plan (Review core)
The re-anchoring algorithm and feedback consolidation are **pure functions** — ideal TDD targets — and should be Task 1 of the Review-core plan (`lib/anchoring.ts`, `lib/feedback.ts`) before any API/UI work.
