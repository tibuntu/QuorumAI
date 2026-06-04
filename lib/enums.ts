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
