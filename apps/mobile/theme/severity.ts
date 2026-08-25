import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";
import type { HazardRecord, JoltEvent } from "@potholeproof/shared-types";
import { colors } from "./colors";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

export interface ClassificationInfo {
  color: string;
  label: string;
  icon: IoniconName;
}

/**
 * Single source of truth for "what does this detection mean, visually" —
 * replaces the byte-identical pinColor() that used to be copy-pasted across
 * App.tsx, AdminScreen.tsx, NavigateScreen.tsx, and CompareScreen.tsx.
 *
 * Map markers use `.color` alone (react-native-maps' pinColor is a plain
 * string prop). List/detail rows should render the full {color, label,
 * icon} via <SeverityBadge> — severity must never be color alone.
 */
export function classify(e: Pick<JoltEvent, "classification" | "severity">): ClassificationInfo {
  if (e.classification === "pothole") {
    if (e.severity >= 0.67) {
      return { color: colors.severity.severe, label: "Severe pothole", icon: "alert-circle" };
    }
    if (e.severity >= 0.34) {
      return { color: colors.severity.moderate, label: "Moderate pothole", icon: "warning" };
    }
    return { color: colors.severity.mild, label: "Minor pothole", icon: "warning-outline" };
  }
  if (e.classification === "speed_bump") {
    return { color: colors.severity.roadHazard, label: "Speed bump", icon: "swap-vertical-outline" };
  }
  if (e.classification === "rough_road") {
    return { color: colors.severity.roughRoad, label: "Rough road", icon: "trail-sign-outline" };
  }
  return { color: colors.severity.neutral, label: "Uncertain", icon: "help-circle-outline" };
}

/**
 * Same visual language as `classify()`, keyed off a crowd HazardRecord's
 * severityBand instead of a JoltEvent's classification+severity — a hazard
 * doesn't carry a JoltClassification. `status: "reported"` gets its own
 * badge treatment since it's filed with the city, not just detected.
 */
export function classifyHazard(h: Pick<HazardRecord, "severityBand" | "status">): ClassificationInfo {
  if (h.status === "reported") {
    return { color: colors.status.info, label: "Reported to city", icon: "megaphone-outline" };
  }
  if (h.severityBand === "severe") {
    return { color: colors.severity.severe, label: "Severe pothole", icon: "alert-circle" };
  }
  if (h.severityBand === "moderate") {
    return { color: colors.severity.moderate, label: "Moderate pothole", icon: "warning" };
  }
  return { color: colors.severity.mild, label: "Minor pothole", icon: "warning-outline" };
}
