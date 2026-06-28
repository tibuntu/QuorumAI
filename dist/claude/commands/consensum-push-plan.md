---
allowed-tools: Bash(curl:*), Bash(cat:*), Bash(jq:*)
description: Push the current plan to a Consensum instance for team review (returns control immediately).
---

Post a plan to Consensum for asynchronous team review, then return control to the user (do NOT block waiting for feedback).

Requires env vars: `CONSENSUM_BASE_URL` (e.g. http://localhost:3000) and `CONSENSUM_API_TOKEN` (from Consensum → Settings → API tokens).

1. Determine the plan markdown: if `$ARGUMENTS` names a file, read it; otherwise use the most recent plan / your last assistant message.
2. Determine a title (first heading of the plan, else "Plan").
3. POST it. Send an `Idempotency-Key` header so a retry never creates a duplicate plan — use a stable value derived from the content (e.g. a short hash of `<title>` + `<markdown>`). Optionally include `agentContext` (free-form context that is echoed back in later feedback so you can recover it after a multi-day review) and `requiredApprovals` (integer 1–10). Capture the HTTP status:
   `curl -s -w '\n%{http_code}' -X POST "$CONSENSUM_BASE_URL/api/plans" -H "Authorization: Bearer $CONSENSUM_API_TOKEN" -H 'content-type: application/json' -H "Idempotency-Key: <stable-key>" -d "$(jq -n --arg t "<title>" --arg m "<markdown>" '{title:$t, markdown:$m}')"`
   Tip: for a multi-line or quote-bearing plan, write the markdown to a temp file and build the body with `jq -n --arg t "<title>" --rawfile m plan.md '{title:$t, markdown:$m}'` so shell quoting can't mangle it.
4. **Check the status code.** On `201` (created) or `200` (idempotent replay of an earlier identical push), parse `{ id, reviewUrl }` and print both: "Plan posted for review: <reviewUrl> (id <id>). I'll resume when you run /consensum-pull-feedback <id>." On any non-2xx — e.g. `401` (bad/expired token), `403` (token missing the `plans:write` scope), `413` (plan markdown too large) — tell the user the push **failed**, with the status and error body, and do NOT claim it succeeded or invent an id.
5. Return control. Do not poll.
