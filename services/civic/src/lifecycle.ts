import type { CivicReportStatus } from "@potholeproof/shared-types";

/**
 * The report lifecycle as the city sees it:
 *   submitted (pending review) → acknowledged → in_progress → closed (complete)
 * with `rejected` available while the report is still open. There are no
 * timers — the city's side (admin screen now, an Open311 poller later) moves it.
 */

/** Plain-language label per status, for badges and notifications. */
export const CIVIC_STATUS_LABEL: Record<CivicReportStatus, string> = {
  draft: "Draft",
  submitted: "Pending city review",
  acknowledged: "Received by the city",
  in_progress: "Repair in progress",
  closed: "Complete",
  rejected: "Rejected",
};

const OPEN: ReadonlySet<CivicReportStatus> = new Set(["draft", "submitted", "acknowledged", "in_progress"]);

export function isOpenStatus(status: CivicReportStatus): boolean {
  return OPEN.has(status);
}

export function isTerminalStatus(status: CivicReportStatus): boolean {
  return !OPEN.has(status);
}

const NEXT: Record<CivicReportStatus, readonly CivicReportStatus[]> = {
  draft: ["submitted"],
  submitted: ["acknowledged", "rejected"],
  acknowledged: ["in_progress", "closed", "rejected"],
  in_progress: ["closed", "rejected"],
  closed: [],
  rejected: [],
};

/** The statuses a city reviewer may move a report to from `status`. */
export function nextCityStatuses(status: CivicReportStatus): readonly CivicReportStatus[] {
  return NEXT[status];
}

/** How long after a report closes or is rejected before the same spot may be filed again. */
export const REFILE_COOLDOWN_DAYS = 7;

export interface RefileCheck {
  ok: boolean;
  /** Why not, when `ok` is false — safe to show to a user. */
  reason?: string;
}

/**
 * May a new report be filed for a hazard whose latest report is `latest`?
 * Never while one is still open; after a close/reject only once the cooldown
 * has passed (so a rejected or "fixed" report can't be instantly re-spammed).
 * `nowMs` is injected — no ambient clock.
 */
export function canFileReport(
  latest: { status: CivicReportStatus; closedAt?: string; submittedAt?: string } | undefined,
  nowMs: number,
  cooldownDays: number = REFILE_COOLDOWN_DAYS
): RefileCheck {
  if (!latest) return { ok: true };
  if (isOpenStatus(latest.status)) {
    return { ok: false, reason: "This hazard already has an open report." };
  }
  const since = Date.parse(latest.closedAt ?? latest.submittedAt ?? "");
  if (Number.isNaN(since)) return { ok: true };
  const waitMs = cooldownDays * 86_400_000 - (nowMs - since);
  if (waitMs > 0) {
    const days = Math.ceil(waitMs / 86_400_000);
    return { ok: false, reason: `You can file again in ${days} day${days === 1 ? "" : "s"}.` };
  }
  return { ok: true };
}
