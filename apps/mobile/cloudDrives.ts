import { deleteDoc, doc, serverTimestamp, setDoc } from "firebase/firestore";
import type { JoltEvent, LatLng } from "@potholeproof/shared-types";
import { db } from "./firebase";

export type CloudLabel = "pothole" | "not_pothole";

export interface CloudLabeledEvent {
  event: JoltEvent;
  label: CloudLabel;
}

/**
 * All drives live in one top-level collection (community-visible), each doc
 * owned by the `uid` that created it. Doc id is namespaced by uid so two
 * users' locally-generated driveIds (`drive-${Date.now()}`) can never collide.
 */
const DRIVES_COLLECTION = "drives";

function cloudDocId(uid: string, driveId: string): string {
  return `${uid}_${driveId}`;
}

/** Throws on failure — callers decide how to surface that (don't swallow silently). */
export async function syncDriveToCloud(
  uid: string,
  driveId: string,
  items: CloudLabeledEvent[],
  route: LatLng[]
): Promise<void> {
  await setDoc(doc(db, DRIVES_COLLECTION, cloudDocId(uid, driveId)), {
    driveId,
    uid,
    items,
    route,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteDriveFromCloud(uid: string, driveId: string): Promise<void> {
  await deleteDoc(doc(db, DRIVES_COLLECTION, cloudDocId(uid, driveId)));
}

export async function upsertUserProfile(
  uid: string,
  email: string | null,
  displayName: string | null
): Promise<void> {
  await setDoc(
    doc(db, "users", uid),
    { email, displayName, updatedAt: serverTimestamp() },
    { merge: true }
  );
}
