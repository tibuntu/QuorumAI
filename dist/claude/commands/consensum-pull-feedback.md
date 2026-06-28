---
allowed-tools: Bash(curl:*), Bash(jq:*)
description: Pull consolidated team feedback for a Consensum plan and revise accordingly.
---

Wait for a team decision on a plan, then revise. This blocks via long-poll instead of one-shot polling, so an agent (or CI) can wait for humans to decide rather than re-running by hand.

This is the **human-in-the-loop** path: you approve each revision before it is posted (step 4d). For fully autonomous operation — auto-revise and auto-implement on approval — use `/consensum-loop`; plans created *inside* plan mode are driven by the `ExitPlanMode` hook.

Requires env vars: `CONSENSUM_BASE_URL` and `CONSENSUM_API_TOKEN`. The plan id is `$ARGUMENTS`.

1. Wait loop — up to 10 iterations, each a ~30s long-poll. The server holds the connection open until the decision/state changes, then returns the feedback body with a `timedOut` flag (HTTP 200 even on timeout):

   ```
   for i in 1..10:
     resp=$(curl -s "$CONSENSUM_BASE_URL/api/plans/$ARGUMENTS/feedback/wait?timeoutMs=30000" \
       -H "Authorization: Bearer $CONSENSUM_API_TOKEN")
     decision=$(echo "$resp" | jq -r .decision)
     if [ "$decision" = "approved" ] || [ "$decision" = "changes_requested" ]; then
       break   # terminal — stop waiting
     fi
     # decision == "pending" (timed out, or a non-terminal change such as a new version): re-arm
   ```

2. If the loop exhausts all 10 iterations with `decision` still `"pending"`: tell the user the plan is still pending after 10 waits (~5 minutes) and stop. Do not block indefinitely.
3. Parse the final response. The shape depends on the server version:

   - **Structured response (`schemaVersion >= 1`)** — the body includes `schemaVersion`, `rollup`, enriched `threads[]`, `currentVersion`, `versions`, and the legacy `markdown` field (kept for backward compatibility).
   - **Legacy response (no `schemaVersion`)** — fall back to rendering the `markdown` field directly (old behaviour).

4. **Present feedback and revise.**

   **If `schemaVersion >= 1`:**

   a. Lead with the rollup summary:
      ```
      rollup.mustResolve — OPEN blockers you must resolve before proceeding (the binding gate)
      rollup.blocking    — blocker-severity threads (severity == BLOCKER)
      rollup.unresolved  — open threads (threadStatus == OPEN)
      rollup.reviewersRequestingChanges — how many reviewers want changes (>=2 ⇒ possible conflict)
      rollup.reviewerSplit — true if some reviewers approve while others reject
      rollup.byCategory  — counts per category
      ```
      Note: rollup counts always reflect **unfiltered totals**, even when threads are filtered below.

   b. To focus the revision on actionable items, fetch the filtered thread list — and exclude `orphaned` threads, whose anchored text no longer exists in the current plan (usually because a prior revision already removed it, so there is nothing left to act on):
      ```
      curl -s "$CONSENSUM_BASE_URL/api/plans/$ARGUMENTS/feedback?include=blocking,unresolved&exclude=orphaned" \
        -H "Authorization: Bearer $CONSENSUM_API_TOKEN"
      ```
      The returned `threads[]` will be narrowed to live blocking / open items. The `rollup` in this response still reflects the full unfiltered totals, so the overall picture is preserved. Each thread also carries `mustResolve` (true for an OPEN blocker) and `anchorState` (`ACTIVE` / `MOVED` / `ORPHANED`).

   c. Group and present threads in severity order: **BLOCKER → MAJOR → MINOR → NIT → (null/unset last)**. For each thread show:
      - `quote` (the anchored text)
      - the **full** comment thread (every `comments[].body`, oldest first) — not just the latest, so earlier still-unaddressed points aren't missed
      - `category`, `raisedOnVersion`
      - for a RESOLVED thread, its `resolution` (`FIXED` / `WONTFIX` / `OBSOLETE`) — `WONTFIX` / `OBSOLETE` need no action

   d. Revise the plan to address every comment, prioritising BLOCKERs first. If the user approves the revision, post it back with `PATCH $CONSENSUM_BASE_URL/api/plans/$ARGUMENTS` `{ markdown, baseVersionNumber }`.

   e. **Binding rule — do not proceed while blocked.** Severity is advisory, but `mustResolve` is binding: the plan is only safe to implement when `decision == "approved"` **and** `rollup.mustResolve == 0`. If `decision == "approved"` but `rollup.mustResolve > 0`, the team approved with open blockers still on the board — do **not** silently implement; surface those blocker threads to the user and hold for an explicit go-ahead.

   f. **Conflicting reviewers — don't pick a side.** If `rollup.reviewersRequestingChanges >= 2` or `rollup.reviewerSplit` is true, multiple humans disagree (or some approve while others reject). Do not invent a reconciliation — present the opposing threads to the user and ask for one agreed direction before revising.

   **If `schemaVersion` is absent (legacy server):**

   Present the `markdown` digest, then revise the plan to address every comment. If the user approves the revision, post it back with `PATCH $CONSENSUM_BASE_URL/api/plans/$ARGUMENTS` `{ markdown, baseVersionNumber }`.
