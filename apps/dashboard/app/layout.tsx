import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "StreetSmart — Repair Scorecards",
  description:
    "Public repair-time scorecards: how fast does your city fix the roads?",
  icons: {
    icon: "/brand/mark.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          background: "#f6f7f9",
          color: "#1a1d21",
        }}
      >
        {children}
      </body>
    </html>
  );
}
