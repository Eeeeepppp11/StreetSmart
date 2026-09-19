import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import type { HazardRecord } from "@potholeproof/shared-types";
import { distanceMeters } from "@potholeproof/geo";
import type { LatLng } from "@potholeproof/shared-types";
import { db } from "./firebase";
import { recordHazardContribution } from "./hazardReports";

export const HAZARD_VOTES_COLLECTION = "hazardVotes";

/** "none" is a retracted vote — the doc stays (no deletes), but counts for nothing. */
export type HazardVote = "confirm" | "gone" | "none";

/** A voter must be this close to the hazard — stops someone across town from
 *  confirming or retiring a pothole they never saw. Generous because the
 *  GPS fix is live while driving at speed. */
export const VOTE_RADIUS_M = 150;

/** Distinct "not there / fixed" votes it takes to retire a hazard — matches the
 *  engine's `minCleanToRetire`, since each gone vote is fed in as a clean pass. */
export const GONE_VOTES_TO_RETIRE = 3;

export function isWithinVoteRange(hazard: HazardRecord, at: LatLng): boolean {
  return distanceMeters(hazard.location, at) <= VOTE_RADIUS_M;
}

/**
 * Cast, change, or retract (`"none"`) this user's vote on a hazard. Doc id is
 * `hazardId_uid`, so a user holds exactly one vote per hazard and changing
 * their mind replaces it.
 * A confirm also counts as a contribution for the leaderboard.
 */
export async function castHazardVote(hazard: HazardRecord, uid: string, vote: HazardVote): Promise<void> {
  await setDoc(doc(db, HAZARD_VOTES_COLLECTION, `${hazard.id}_${uid}`), {
    hazardId: hazard.id,
    uid,
    vote,
    location: hazard.location,
    severity: hazard.severity,
    votedAt: new Date().toISOString(),
    createdAt: serverTimestamp(),
  });
  if (vote === "confirm") await recordHazardContribution(hazard.id, uid);
}
