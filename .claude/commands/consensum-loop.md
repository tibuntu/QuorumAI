---
allowed-tools: Bash(curl:*), Bash(jq:*), Bash(sleep:*)
description: Wait for a Consensum plan's verdict and auto-proceed — implement on approval, auto-revise on changes-requested.
---

Autonomously drive a plan to a decision and act on it. Unlike `/consensum-pull-feedback` (one-shot: pull → revise → return control), this **loops**: it keeps waiting through revision rounds until the team approves, then proceeds to implement.

Use this for plans pushed **outside** plan mode (e.g. after `/consensum-push-plan`, or from a markdown file). Plans created *inside* plan mode are handled automatically by the `ExitPlanMode` hook (see README → Connecting your agent); you don't need this command for those.

Requires env vars `CONSENSUM_BASE_URL` and `CONSENSUM_API_TOKEN`. Args: `<id> [intervalMinutes]` — `$ARGUMENTS`. The plan `<id>` is the value returned by `/consensum-push-plan`. If `intervalMinutes` is given, poll on that fixed interval instead of long-polling.

Loop until the decision is terminal **and acted upon**:

1. **Wait for activity.**
   - Default (no interval): long-poll —
     ```
     curl -s "$CONSENSUM_BASE_URL/api/plans/<id>/feedback/wait?timeoutMs=30000" \
       -H "Authorization: Bearer $CONSENSUM_API_TOKEN"
     ```
     Re-arm on `timedOut`/`decision == "pending"`.
   - Interval mode: `sleep <intervalMinutes>*60`, then
     ```
     curl -s "$CONSENSUM_BASE_URL/api/plans/<id>/feedback" -H "Authorization: Bearer $CONSENSUM_API_TOKEN"
     ```

2. **On `decision == "approved"`:** first check the binding gate — fetch `feedback` and confirm `rollup.mustResolve == 0` (no OPEN blockers remain). If clear, announce it and **proceed to implement the plan now**, in the current session, honoring whatever permission mode the session is already in (do not attempt to escalate permissions); stop looping. If `rollup.mustResolve > 0` (the team approved with open blockers still on the board), do **not** implement — surface those blocker threads to the user, and keep looping / hold for an explicit go-ahead. Severity is advisory; `mustResolve` is the binding signal.

3. **On `decision == "changes_requested"`:** pull the actionable threads —
   ```
   curl -s "$CONSENSUM_BASE_URL/api/plans/<id>/feedback?include=blocking,unresolved&exclude=orphaned" \
     -H "Authorization: Bearer $CONSENSUM_API_TOKEN"
   ```
   (`exclude=orphaned` drops threads whose anchored text a prior revision already removed — nothing left to act on.) Present them in severity order (BLOCKER → MAJOR → MINOR → NIT), revise the plan to address every point (blockers first), and post the revision:
   ```
   curl -s -X PATCH "$CONSENSUM_BASE_URL/api/plans/<id>" -H "Authorization: Bearer $CONSENSUM_API_TOKEN" \
     -H 'content-type: application/json' \
     -d "$(jq -n --arg m "<revised markdown>" --argjson v <currentVersionNumber> '{markdown:$m, baseVersionNumber:$v}')"
   ```
   On HTTP 409 (`stale version`), re-`GET .../feedback`, take the new `currentVersion`, and retry once. Announce the revision, then **continue looping** — but do **not** re-revise on the *same* feedback: a revision keeps the reviewer's `changes_requested` until they re-review, so wait for the `reviews`/thread set to actually change (a new verdict or new comments) before treating it as a fresh round. Track the prior reviewer state to detect this.

   **Conflicting reviewers:** if `rollup.reviewersRequestingChanges >= 2` or `rollup.reviewerSplit` is true, reviewers disagree (or some approve while others reject) — do not guess a reconciliation; surface the opposing threads and pause for an agreed direction rather than auto-revising.

4. **Stop conditions:** approved (→ implemented), or no terminal decision after a generous number of waits — then report it's still pending and stop. Never loop indefinitely. (Rationale for the differing caps: the interactive commands stop after ~5 minutes since a human is present to re-run them; the plan-mode `ExitPlanMode` hook waits up to 4 days because it must block an *unattended* agent through a full asynchronous team review. Match your cap to how long your reviewers realistically take.)
