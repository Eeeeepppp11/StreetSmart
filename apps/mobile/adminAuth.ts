const DEFAULT_ADMIN_EMAILS = ["aaryamanchopra25@outlook.com"];

/** Configurable via EXPO_PUBLIC_ADMIN_EMAILS (comma-separated) — falls back to the hardcoded owner email. */
const rawAdminEmails: string | undefined = process.env.EXPO_PUBLIC_ADMIN_EMAILS;

export const ADMIN_EMAILS = (rawAdminEmails ? rawAdminEmails.split(",") : DEFAULT_ADMIN_EMAILS)
  .map((e: string) => e.trim().toLowerCase())
  .filter(Boolean);

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.includes(email.trim().toLowerCase());
}
