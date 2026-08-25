import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { buildScorecard, buildRouteRiskExport } from "@potholeproof/analytics";
import {
  AS_OF,
  CONTRIBUTIONS,
  HAZARDS,
  REPORTS,
  districtOf,
  tileOf,
} from "./demo-data";

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

export default function Page() {
  const scorecard = buildScorecard(REPORTS, HAZARDS, { districtOf, asOf: AS_OF });
  const risk = buildRouteRiskExport(HAZARDS, CONTRIBUTIONS, {
    tileOf,
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
      <h1 style={{ marginBottom: 4, fontSize: 20 }}>Repair Scorecards</h1>
      <p style={{ color: "#5b6570", marginTop: 0 }}>
        How fast does the city fix what drivers report? Rendered by the same
        aggregation engine that will serve live data.{" "}
        <strong>Demo dataset</strong> until the live backend is connected.{" "}
        <Link href="/priorities" style={{ color: "#e8442e" }}>
          View repair priority queue →
        </Link>
      </p>

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 20 }}>
          Repair performance by district
        </h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>District</th>
              <th style={th}>Reported</th>
              <th style={th}>Open</th>
              <th style={th}>Fixed</th>
              <th style={th}>Median repair</th>
              <th style={th}>Oldest open</th>
            </tr>
          </thead>
          <tbody>
            {scorecard.map((row) => (
              <tr key={row.district}>
                <td style={{ ...td, fontWeight: 600 }}>{row.district}</td>
                <td style={td}>{row.reported}</td>
                <td style={td}>{row.open}</td>
                <td style={td}>{row.closed}</td>
                <td style={td}>{fmtDays(row.medianRepairDays)}</td>
                <td style={td}>{fmtDays(row.oldestOpenDays)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: 20 }}>Road-risk snapshot</h2>
        <p style={{ color: "#5b6570", marginTop: 0, fontSize: 14 }}>
          Anonymised, k-suppressed cells — the same rows licensed to public
          works and fleet partners.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Cell</th>
              <th style={th}>Risk</th>
              <th style={th}>Open hazards</th>
              <th style={th}>Severe</th>
              <th style={th}>Contributors</th>
            </tr>
          </thead>
          <tbody>
            {risk.map((row) => (
              <tr key={row.h3Cell}>
                <td style={{ ...td, fontFamily: "monospace" }}>{row.h3Cell}</td>
                <td style={{ ...td, fontWeight: 600 }}>
                  {(row.riskScore * 100).toFixed(0)}%
                </td>
                <td style={td}>{row.openHazards}</td>
                <td style={td}>{row.severeHazards}</td>
                <td style={td}>{row.contributorCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <footer style={{ color: "#8a939d", fontSize: 13 }}>
        StreetSmart — every commute is a road survey.
      </footer>
    </main>
  );
}
