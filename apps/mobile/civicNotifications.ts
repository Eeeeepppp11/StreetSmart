import type { CivicReportDoc } from "./civicMock";

/** Reports whose last change is older than this are history, not news. */
export const NOTIFY_WITHIN_MS = 24 * 60 * 60 * 1000;

export function lastChangeMs(r: CivicReportDoc): number {
  const last = r.history?.[r.history.length - 1]?.at ?? r.lastCheckedAt ?? r.submittedAt;
  return Date.parse(last);
}

/**
 * The in-app notification for a report reaching `r.status`, or null when there's
 * nothing to say. `mine` = this account filed it; otherwise it's a hazard they
 * helped confirm.
 */
export function civicStatusNotification(
  r: CivicReportDoc,
  mine: boolean
): { title: string; body: string } | null {
  const subject = mine ? "your report" : "the report on a pothole you confirmed";
  const where = r.address ? ` (${r.address})` : "";
  const cityNote = r.statusNote ? ` City note: ${r.statusNote}` : "";
  switch (r.status) {
    case "submitted":
      // The filer just did this themselves; only confirmers need telling.
      return mine
        ? null
        : {
            title: "Reported to the city",
            body: `A pothole you confirmed${where} was reported to the city and is pending review.`,
          };
    case "acknowledged":
      return { title: "The city got the report", body: `The city received ${subject}${where}.${cityNote}` };
    case "in_progress":
      return { title: "Repair in progress", body: `The city started work on ${subject}${where}.${cityNote}` };
    case "closed":
      return { title: "Pothole fixed!", body: `The city marked ${subject}${where} complete.${cityNote}` };
    case "rejected":
      return { title: "Report rejected", body: `The city rejected ${subject}${where}.${cityNote}` };
    default:
      return null;
  }
}
