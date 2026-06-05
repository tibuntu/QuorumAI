---
allowed-tools: Bash(curl:*), Bash(jq:*)
description: Pull consolidated team feedback for a Quorum AI plan and revise accordingly.
---

Fetch consolidated review feedback for a plan and use it to revise.

Requires env vars: `QUORUM_BASE_URL` and `QUORUM_API_TOKEN`. The plan id is `$ARGUMENTS`.

1. GET feedback:
   `curl -s "$QUORUM_BASE_URL/api/plans/$ARGUMENTS/feedback" -H "Authorization: Bearer $QUORUM_API_TOKEN"`
2. Parse `{ decision, state, markdown, threads, reviews }`.
3. If `decision` is "pending": tell the user no decision yet and stop.
4. Otherwise, present the `markdown` digest, then revise the plan to address every comment. If the user approves the revision, post it back with `PATCH $QUORUM_BASE_URL/api/plans/$ARGUMENTS` `{ markdown, baseVersionNumber }`.
