// Pure, side-effect-free helpers for the Consensum ExitPlanMode hook
// (consensum-exit-plan.mjs). Extracted so the verdict logic, fingerprint, and
// digest can be unit-tested without running the hook's I/O or blocking loop.

export function titleFromMarkdown(md) {
  const m = (md || "").match(/^\s*#\s+(.+?)\s*$/m);
  return (m && m[1].trim()) || "Plan";
}

// The exact PermissionRequest `hookSpecificOutput` shapes Claude Code expects.
// Centralized here so a regression test pins the handshake contract;
// the hook emits these verbatim.
export function allowPayload() {
  return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "allow" } } };
}
export function denyPayload(message) {
  return { hookSpecificOutput: { hookEventName: "PermissionRequest", decision: { behavior: "deny", message } } };
}

// A digest of reviewer ACTIVITY (not the plan version), so PATCHing a revision
// alone does not look like new feedback — only an actual re-review does. This is
// what prevents a re-revision storm on the hook path.
export function fingerprint(fb) {
  const reviews = (fb.reviews || [])
    .map((r) => `${r.reviewer}|${r.verdict}|${r.dismissed}`)
    .sort()
    .join(";");
  const threads = (fb.threads || [])
    .map((t) => {
      const cs = t.comments || [];
      const last = cs.length ? cs[cs.length - 1].body : "";
      return `${t.id}|${t.threadStatus}|${cs.length}|${last}`;
    })
    .sort()
    .join(";");
  return `a=${fb.approvals};r=[${reviews}];t=[${threads}]`;
}

export const SEV_RANK = { BLOCKER: 0, MAJOR: 1, MINOR: 2, NIT: 3 };

export function buildDigest(fb, reviewUrl) {
  const lines = [
    `The team reviewed your plan and requested changes (approvals ${fb.approvals}/${fb.requiredApprovals}).`,
    `Blocking: ${fb.rollup?.blocking ?? 0}, unresolved: ${fb.rollup?.unresolved ?? 0}, must-resolve blockers: ${fb.rollup?.mustResolve ?? 0}.`,
    "",
  ];
  const threads = [...(fb.threads || [])].sort((a, b) => {
    const ra = SEV_RANK[a.severity] ?? (a.threadStatus === "OPEN" ? 4 : 5);
    const rb = SEV_RANK[b.severity] ?? (b.threadStatus === "OPEN" ? 4 : 5);
    return ra - rb;
  });
  if (threads.length === 0) lines.push("_No inline comments — see the review for verdict rationale._");
  for (const t of threads) {
    const sev = t.severity ? `[${t.severity}] ` : "";
    const mustFix = t.mustResolve ? " (MUST RESOLVE)" : "";
    const cs = t.comments || [];
    lines.push(`- ${sev}On "${t.quote ?? "(unanchored)"}"${mustFix}:`);
    // Emit the FULL discussion, not just the last comment — an agent that
    // sees only the latest reply can miss earlier, still-unaddressed points.
    if (cs.length === 0) lines.push("    (no comment)");
    for (const c of cs) lines.push(`    • ${c.body}`);
  }
  lines.push("", `Full review: ${reviewUrl}`, "Revise the plan to address every point (blockers first), then present the updated plan.");
  return lines.join("\n");
}

// Verdict logic for a feedback snapshot, given the fingerprint of the reviewer
// activity we last relayed. Pure — the hook performs the I/O around it.
//   approved          -> allow (Claude exits plan mode and implements)
//   changes_requested -> deny (new activity) | wait (stale: our revision not yet re-reviewed)
//   pending           -> keep long-polling
export function decide(fb, lastFingerprint) {
  const decision = fb?.decision;
  if (decision === "approved") return { action: "allow" };
  if (decision === "changes_requested") {
    const fp = fingerprint(fb);
    return fp !== lastFingerprint ? { action: "deny", fingerprint: fp } : { action: "wait", fingerprint: fp };
  }
  return { action: "pending" };
}
