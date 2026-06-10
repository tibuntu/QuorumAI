export const DOCUMENT_STATES = ["DRAFT", "OPEN", "CHANGES_REQUESTED", "APPROVED", "CLOSED"] as const;
export type DocumentState = (typeof DOCUMENT_STATES)[number];

export const DOCUMENT_SOURCES = ["WEB", "CLAUDE_CODE"] as const;
export type DocumentSource = (typeof DOCUMENT_SOURCES)[number];

export const ANNOTATION_KINDS = ["COMMENT", "SUGGESTION"] as const;
export type AnnotationKind = (typeof ANNOTATION_KINDS)[number];

export const ANCHOR_STATUSES = ["ACTIVE", "MOVED", "ORPHANED"] as const;
export type AnchorStatus = (typeof ANCHOR_STATUSES)[number];

export const THREAD_STATUSES = ["OPEN", "RESOLVED"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export const REVIEW_VERDICTS = ["APPROVE", "REQUEST_CHANGES", "COMMENT"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];

export const SEVERITIES = ["BLOCKER", "MAJOR", "MINOR", "NIT"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const WEBHOOK_EVENTS = ["version.created", "review.updated", "decision.changed", "comment.created"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const SESSION_ACTIONS = ["start", "join", "leave", "end"] as const;
export type SessionAction = (typeof SESSION_ACTIONS)[number];
