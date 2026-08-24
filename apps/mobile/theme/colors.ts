/**
 * Canonical color tokens for the app. Resolves two drifted duplicate pairs
 * found across the pre-redesign screens: the app used both #2e9e4f and
 * #1a7f37 for "success" (only #1a7f37 passes WCAG AA text contrast on white,
 * 5.08:1 vs 3.43:1), and both #4a72da and #1f6fe8 for "route/info blue"
 * (only #1f6fe8 passes, 4.67:1 vs 4.46:1). Every screen should import from
 * here instead of hardcoding a hex value.
 */
export const colors = {
  brand: {
    primary: "#e8442e",
    primaryPressed: "#c73a26",
    primaryTint: "#fbe3e0",
  },
  severity: {
    severe: "#d92616",
    moderate: "#e8812e",
    mild: "#e6b91e",
    roadHazard: "#1f6fe8",
    roughRoad: "#c2703a",
    neutral: "#8a939d",
  },
  status: {
    success: "#1a7f37",
    successTint: "#d9f2df",
    warning: "#e8812e",
    warningTint: "#fbe7c8",
    danger: "#d92616",
    dangerTint: "#fbe3e0",
    info: "#1f6fe8",
    infoTint: "#eaf1fd",
  },
  neutral: {
    bg: "#f6f7f9",
    surface: "#ffffff",
    surfaceAlt: "#eef0f2",
    border: "#e3e6ea",
    divider: "#eef0f2",
    ink: "#1a1d21",
    inkSoft: "#5b6570",
    inkFaint: "#8a939d",
    inkDisabled: "#c3c9d0",
  },
  dark: {
    bg: "#101317",
  },
  white: "#ffffff",
} as const;
