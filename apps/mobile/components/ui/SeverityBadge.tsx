import { Badge } from "./Badge";
import type { ClassificationInfo } from "../../theme";

interface SeverityBadgeProps {
  info: ClassificationInfo;
}

/** Pairs the severity color with an icon + text label — color is never the only signal. */
export function SeverityBadge({ info }: SeverityBadgeProps) {
  return <Badge label={info.label} icon={info.icon} color={info.color} />;
}
