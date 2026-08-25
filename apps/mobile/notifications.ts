import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Local, per-account notification history — currently the only durable
 * record of "your report got fixed" events (App.tsx's fix-verification
 * effect fires a one-time Alert that leaves no trace once dismissed). Not
 * synced to Firestore: this is a per-device inbox, same posture as the
 * existing `pp.seenFixedReports.${uid}` dedupe key it sits next to.
 */
export interface AppNotification {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
}

const MAX_NOTIFICATIONS = 50;

function keyFor(uid: string): string {
  return `pp.notifications.v1.${uid}`;
}

export async function loadNotifications(uid: string): Promise<AppNotification[]> {
  const raw = await AsyncStorage.getItem(keyFor(uid));
  return raw ? (JSON.parse(raw) as AppNotification[]) : [];
}

async function saveNotifications(uid: string, list: AppNotification[]): Promise<void> {
  await AsyncStorage.setItem(keyFor(uid), JSON.stringify(list));
}

/** Prepends a new notification (newest first), capped at {@link MAX_NOTIFICATIONS}. */
export async function addNotification(
  uid: string,
  notification: Pick<AppNotification, "title" | "body">
): Promise<AppNotification[]> {
  const existing = await loadNotifications(uid);
  const next = [
    {
      ...notification,
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      read: false,
    },
    ...existing,
  ].slice(0, MAX_NOTIFICATIONS);
  await saveNotifications(uid, next);
  return next;
}

export async function markAllNotificationsRead(uid: string): Promise<AppNotification[]> {
  const existing = await loadNotifications(uid);
  if (existing.every((n) => n.read)) return existing;
  const next = existing.map((n) => ({ ...n, read: true }));
  await saveNotifications(uid, next);
  return next;
}
