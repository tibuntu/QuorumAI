---
allowed-tools: Bash(curl:*), Bash(jq:*)
description: Pull consolidated team feedback for a Quorum AI plan and revise accordingly.
---

Wait for a team decision on a plan, then revise. This blocks via long-poll instead of one-shot polling, so an agent (or CI) can wait for humans to decide rather than re-running by hand.

Requires env vars: `QUORUM_BASE_URL` and `QUORUM_API_TOKEN`. The plan id is `$ARGUMENTS`.

1. Wait loop — up to 10 iterations, each a ~30s long-poll. The server holds the connection open until the decision/state changes, then returns the feedback body with a `timedOut` flag (HTTP 200 even on timeout):

   ```
   for i in 1..10:
     resp=$(curl -s "$QUORUM_BASE_URL/api/plans/$ARGUMENTS/feedback/wait?timeoutMs=30000" \
       -H "Authorization: Bearer $QUORUM_API_TOKEN")
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
      rollup.blocking   — must-fix blockers (severity == BLOCKER)
      rollup.unresolved — open threads (status == OPEN)
      rollup.byCategory — counts per category
      ```
      Note: rollup counts always reflect **unfiltered totals**, even when threads are filtered below.

   b. To focus the revision on actionable items, fetch the filtered thread list:
      ```
      curl -s "$QUORUM_BASE_URL/api/plans/$ARGUMENTS/feedback?include=blocking,unresolved" \
        -H "Authorization: Bearer $QUORUM_API_TOKEN"
      ```
      The returned `threads[]` will be narrowed to blocking / open items. The `rollup` in this response still reflects the full unfiltered totals, so the overall picture is preserved.

   c. Group and present threads in severity order: **BLOCKER → MAJOR → MINOR → NIT → (null/unset last)**. For each thread show:
      - `quote` (the anchored text)
      - latest comment body
      - `category`
      - `raisedOnVersion`

   d. Revise the plan to address every comment, prioritising BLOCKERs first. If the user approves the revision, post it back with `PATCH $QUORUM_BASE_URL/api/plans/$ARGUMENTS` `{ markdown, baseVersionNumber }`.

   **If `schemaVersion` is absent (legacy server):**

   Present the `markdown` digest, then revise the plan to address every comment. If the user approves the revision, post it back with `PATCH $QUORUM_BASE_URL/api/plans/$ARGUMENTS` `{ markdown, baseVersionNumber }`.
