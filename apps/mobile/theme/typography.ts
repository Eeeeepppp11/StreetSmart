import { colors } from "./colors";

/**
 * Manrope (display) + IBM Plex Sans (body/UI) + IBM Plex Mono (every
 * numeric readout — speed HUD, jolt counts, confidence %, model metrics).
 * Mono is a functional choice as much as a stylistic one: tabular figures
 * don't jitter in width as a live value updates mid-drive. Same pairing as
 * docs/demo-cohort-report.html, so the app and the written report read as
 * one product.
 */
export const fontFamily = {
  display: "Manrope_800ExtraBold",
  displaySemi: "Manrope_700Bold",
  body: "IBMPlexSans_400Regular",
  bodyMedium: "IBMPlexSans_500Medium",
  bodySemibold: "IBMPlexSans_600SemiBold",
  bodyBold: "IBMPlexSans_700Bold",
  mono: "IBMPlexMono_600SemiBold",
  monoMedium: "IBMPlexMono_500Medium",
  monoBold: "IBMPlexMono_700Bold",
} as const;

export const typeScale = {
  display: { fontFamily: fontFamily.display, fontSize: 34, lineHeight: 40, color: colors.neutral.ink },
  h1: { fontFamily: fontFamily.display, fontSize: 28, lineHeight: 34, color: colors.neutral.ink },
  h2: { fontFamily: fontFamily.displaySemi, fontSize: 20, lineHeight: 26, color: colors.neutral.ink },
  title: { fontFamily: fontFamily.bodyBold, fontSize: 17, lineHeight: 22, color: colors.neutral.ink },
  body: { fontFamily: fontFamily.body, fontSize: 15, lineHeight: 21, color: colors.neutral.ink },
  bodyMedium: { fontFamily: fontFamily.bodyMedium, fontSize: 15, lineHeight: 21, color: colors.neutral.ink },
  caption: { fontFamily: fontFamily.bodyMedium, fontSize: 13, lineHeight: 18, color: colors.neutral.inkSoft },
  label: {
    fontFamily: fontFamily.bodySemibold,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: "uppercase" as const,
    color: colors.neutral.inkFaint,
  },
  statValue: { fontFamily: fontFamily.mono, fontSize: 26, color: colors.neutral.ink },
  statValueLg: { fontFamily: fontFamily.mono, fontSize: 48, color: colors.neutral.ink },
  numeric: { fontFamily: fontFamily.monoMedium, fontSize: 15, color: colors.neutral.ink },
} as const;
