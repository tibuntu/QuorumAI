# M4 · P4 — Health & Readiness Probes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/healthz` (liveness) and `/readyz` (readiness, DB `SELECT 1`) endpoints and wire container healthchecks.

**Architecture:** Two unauthenticated app-root GET route handlers (`force-dynamic`). Liveness is dependency-free; readiness pings the DB via Prisma. Dockerfile + compose get a Node-`fetch` healthcheck against `/readyz`; README documents the probe paths and a k8s snippet.

**Tech Stack:** Next.js App Router route handlers, Prisma (`$queryRaw`), Vitest, Docker.

**Design spec:** `docs/superpowers/specs/2026-06-08-quorum-ai-m4-p4-health-probes-design.md`

**Worktree/env notes:** isolated worktree off `main`; `CI=true` on script runs; `.env`+`data/`+`prisma migrate deploy` for the unit suite; rebase onto `main`. The Prisma client import path: match what existing routes use — grep `grep -rn "prisma" lib/ app/api | grep import` (the spec references `@/lib/db`; confirm before importing).

---

### Task 1: `/healthz` + `/readyz` route handlers

**Goal:** Liveness returns 200 unconditionally; readiness returns 200 when the DB answers `SELECT 1`, else 503.

**Files:**
- Create: `app/healthz/route.ts`
- Create: `app/readyz/route.ts`
- Test: `tests/unit/healthz.test.ts`
- Test: `tests/unit/readyz.test.ts`

**Acceptance Criteria:**
- [ ] `GET /healthz` → 200, body `{ status: "ok" }`, no DB access.
- [ ] `GET /readyz` → 200 `{ status: "ok" }` when `SELECT 1` succeeds.
- [ ] `GET /readyz` → 503 `{ status: "unavailable" }` when the DB query throws.
- [ ] Both export `dynamic = "force-dynamic"`.

**Verify:** `CI=true pnpm exec vitest run tests/unit/healthz.test.ts tests/unit/readyz.test.ts` → PASS.

**Steps:**

- [ ] **Step 1: Write the failing tests.**

```ts
// tests/unit/healthz.test.ts
import { describe, expect, test } from "vitest";
import { GET } from "@/app/healthz/route";

describe("GET /healthz", () => {
  test("returns 200 ok", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
```

```ts
// tests/unit/readyz.test.ts
import { describe, expect, test, vi, afterEach } from "vitest";
import { prisma } from "@/lib/db"; // match the path existing routes use
import { GET } from "@/app/readyz/route";

afterEach(() => vi.restoreAllMocks());

describe("GET /readyz", () => {
  test("200 when DB responds", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("503 when DB query throws", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: "unavailable" });
  });
});
```

- [ ] **Step 2: Run to verify they fail.** Run: `CI=true pnpm exec vitest run tests/unit/healthz.test.ts tests/unit/readyz.test.ts` → FAIL (routes missing).

- [ ] **Step 3: Implement the routes.**

```ts
// app/healthz/route.ts
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ status: "ok" });
}
```

```ts
// app/readyz/route.ts
import { prisma } from "@/lib/db"; // match existing prisma import path

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
```

- [ ] **Step 4: Run to verify they pass.** Run: `CI=true pnpm exec vitest run tests/unit/healthz.test.ts tests/unit/readyz.test.ts` → PASS. Then `CI=true pnpm exec tsc --noEmit && CI=true pnpm exec next lint` → clean.

- [ ] **Step 5: Commit.**

```bash
git add app/healthz/route.ts app/readyz/route.ts tests/unit/healthz.test.ts tests/unit/readyz.test.ts
git commit -m "feat(m4-p4): /healthz liveness + /readyz readiness (SELECT 1) endpoints"
```

---

### Task 2: Container healthchecks + README docs

**Goal:** Docker image and compose service report health via `/readyz`; README documents the probes.

**Files:**
- Modify: `Dockerfile` (add `HEALTHCHECK`)
- Modify: `docker-compose.yml` (add `healthcheck` to the `app` service)
- Modify: `README.md` (probe paths + k8s snippet)

**Acceptance Criteria:**
- [ ] `Dockerfile` has a `HEALTHCHECK` hitting `/readyz` via a Node `fetch` one-liner (no curl/wget dependency).
- [ ] `docker-compose.yml` `app` service has an equivalent `healthcheck` block.
- [ ] README documents `/healthz` + `/readyz` and includes a copy-paste k8s liveness/readiness/startup snippet.

**Verify:** `docker build -t quorum-health-test .` succeeds; `docker run --rm -p 3000:3000 -e BETTER_AUTH_SECRET=$(openssl rand -base64 32) quorum-health-test` → `docker ps` shows the container reaching `healthy`. (If Docker isn't available in the exec environment, verify the endpoints with `pnpm dev` + `curl -i localhost:3000/healthz localhost:3000/readyz` and note Docker verification as manual.)

**Steps:**

- [ ] **Step 1: Add the Dockerfile `HEALTHCHECK`** before the start `CMD` (the line running `node server.js`):

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

- [ ] **Step 2: Add the compose `healthcheck`** under the `app` service in `docker-compose.yml`:

```yaml
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 3s
      start_period: 20s
      retries: 3
```

- [ ] **Step 3: Document in README.** Add a "Health checks" subsection near the container/deploy docs:

```markdown
### Health checks

- `GET /healthz` — liveness (process up; no dependencies).
- `GET /readyz` — readiness (returns 503 if the database is unreachable).

Kubernetes example:

```yaml
livenessProbe:
  httpGet: { path: /healthz, port: 3000 }
  periodSeconds: 10
readinessProbe:
  httpGet: { path: /readyz, port: 3000 }
  periodSeconds: 10
startupProbe:
  httpGet: { path: /readyz, port: 3000 }
  failureThreshold: 30
  periodSeconds: 2
```
```

- [ ] **Step 4: Verify** per the **Verify** line (Docker build/run if available, else dev-server curl + note).

- [ ] **Step 5: Commit.**

```bash
git add Dockerfile docker-compose.yml README.md
git commit -m "feat(m4-p4): container healthchecks on /readyz + probe docs"
```

---

## Self-Review

- **Spec coverage:** `/healthz` + `/readyz` (incl. 503 path) → Task 1; Dockerfile + compose healthcheck + README/k8s snippet → Task 2. All spec "Files touched" covered.
- **Type/name consistency:** both routes export `GET` + `dynamic`; readiness test mocks `prisma.$queryRaw` matching the impl call.
- **Placeholders:** none — full code per step; the prisma import-path note is a verification instruction.

**Dependencies:** Task 2 blockedBy Task 1.
