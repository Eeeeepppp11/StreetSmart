import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { buildPriorityQueue } from "@potholeproof/analytics";
import {
  AS_OF,
  CONTRIBUTIONS,
  HAZARDS,
  REPORTS,
  cityOf,
  tileOf,
} from "../demo-data";

const card: CSSProperties = {
  background: "#fff",
  borderRadius: 12,
  padding: "1.25rem 1.5rem",
  boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
  marginBottom: "1.5rem",
};
const th: CSSProperties = {
  textAlign: "left",
  padding: "0.5rem 0.75rem",
  borderBottom: "2px solid #e3e6ea",
  fontSize: 13,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "#5b6570",
};
const td: CSSProperties = {
  padding: "0.5rem 0.75rem",
  borderBottom: "1px solid #eef0f3",
};

function fmtDays(d: number | null): string {
  return d === null ? "—" : `${d} d`;
}

export default function PrioritiesPage() {
  const queue = buildPriorityQueue(HAZARDS, REPORTS, CONTRIBUTIONS, {
    tileOf,
    cityOf,
    k: 3,
    asOf: AS_OF,
    halfLifeDays: 30,
    riskScale: 2,
  });

  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "2rem 1rem" }}>
      <Image
        src="/brand/logo-horizontal.png"
        alt="StreetSmart"
        width={280}
        height={140}
        style={{ width: 220, height: "auto", marginBottom: 8 }}
        priority
      />
      <h1 style={{ marginBottom: 4, fontSize: 20 }}>Repair priority queue</h1>
      <p style={{ color: "#5b6570", marginTop: 0 }}>
        Which cells to fix first, ranked by urgency — decayed severity ×
        confidence evidence, same scoring as the road-risk export, sorted
        instead of grouped by cell. <strong>Demo dataset</strong> until the
        live backend is connected.{" "}
        <Link href="/" style={{ color: "#e8442e" }}>
          View repair scorecards →
        </Link>
      </p>

      <section style={card}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Cell</th>
              <th style={th}>City</th>
              <th style={th}>Urgency</th>
              <th style={th}>Open hazards</th>
              <th style={th}>Severe</th>
              <th style={th}>Open reports</th>
              <th style={th}>Oldest open</th>
              <th style={th}>Contributors</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((row) => (
              <tr key={row.h3Cell}>
                <td style={{ ...td, fontFamily: "monospace" }}>{row.h3Cell}</td>
                <td style={td}>{row.city}</td>
                <td style={{ ...td, fontWeight: 600 }}>{(row.urgencyScore * 100).toFixed(0)}%</td>
                <td style={td}>{row.openHazards}</td>
                <td style={td}>{row.severeHazards}</td>
                <td style={td}>{row.openReports}</td>
                <td style={td}>{fmtDays(row.oldestOpenReportDays)}</td>
                <td style={td}>{row.contributorCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {queue.length === 0 && (
          <p style={{ color: "#8a939d", fontSize: 14 }}>
            No cells clear the k-anonymity floor yet — nothing to prioritise until enough drivers confirm the same hazard.
          </p>
        )}
      </section>

      <footer style={{ color: "#8a939d", fontSize: 13 }}>
        StreetSmart — every commute is a road survey.
      </footer>
    </main>
  );
}
