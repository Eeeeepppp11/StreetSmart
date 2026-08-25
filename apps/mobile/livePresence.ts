import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import type { GpsFix } from "@potholeproof/detector";
import type { HeadingDegrees, LatLng } from "@potholeproof/shared-types";
import { db } from "./firebase";

/**
 * Ephemeral "other drivers" layer — a live position, only while actively
 * driving. Deleted the instant a drive stops, never archived anywhere. This
 * is a genuinely new privacy surface (a live, precise location broadcast),
 * unlike everything else the app writes, which is batched and post-drive.
 */
export const LIVE_PRESENCE_COLLECTION = "livePresence";

/** A doc older than this is treated as stale and filtered out client-side —
 *  there's no `onDisconnect` on the Firestore Web SDK (that's RTDB-only), so
 *  a killed app otherwise leaves its last position lingering. */
export const PRESENCE_STALE_MS = 30_000;

export interface LivePresenceDoc {
  uid: string;
  displayName: string | null;
  location: LatLng;
  headingDegrees: HeadingDegrees | null;
  speedMps: number;
  updatedAt: { toMillis?: () => number } | null;
}

export async function publishPresence(
  uid: string,
  displayName: string | null,
  fix: GpsFix
): Promise<void> {
  await setDoc(
    doc(db, LIVE_PRESENCE_COLLECTION, uid),
    {
      uid,
      displayName,
      location: fix.location,
      headingDegrees: fix.heading ?? null,
      speedMps: fix.speedMps,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function clearPresence(uid: string): Promise<void> {
  await deleteDoc(doc(db, LIVE_PRESENCE_COLLECTION, uid));
}

export function subscribeToLivePresence(
  onChange: (drivers: LivePresenceDoc[]) => void
): Unsubscribe {
  return onSnapshot(collection(db, LIVE_PRESENCE_COLLECTION), (snap) => {
    onChange(snap.docs.map((d) => d.data() as LivePresenceDoc));
  });
}

export function isPresenceStale(p: LivePresenceDoc): boolean {
  const ms = p.updatedAt?.toMillis?.();
  return !ms || Date.now() - ms > PRESENCE_STALE_MS;
}
