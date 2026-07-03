/**
 * Tunables for the confidence / self-heal engine. Confidence is a Beta-style
 * smoothed ratio of detection evidence to clean-pass evidence:
 *
 *   confidence = (hitScore + α) / (hitScore + missWeight·cleanPasses + α + β)
 *
 * where `hitScore` sums the confidence of each detection (a high-confidence hit
 * counts more than a marginal one). Clean passes (a vehicle crossing a known
 * hazard cell without a jolt) push confidence down; enough of them retire the
 * hazard — the self-healing map, with no manual moderation.
 */
export interface HazardEngineConfig {
  /** Beta prior — α biases toward "present", β toward "absent". */
  priorAlpha: number;
  priorBeta: number;
  /** Weight of each clean pass relative to a unit of detection evidence. */
  missWeight: number;
  /** Below this confidence (with enough clean passes) a hazard retires. */
  retireThreshold: number;
  /** At/above this confidence a hazard is (re)activated. */
  activateThreshold: number;
  /** Minimum clean passes before a hazard may retire (needs real evidence). */
  minCleanToRetire: number;
  /** Severity-band cutoffs on the 0..1 aggregate severity. */
  moderateAt: number;
  severeAt: number;
}

export const DEFAULT_HAZARD_CONFIG: HazardEngineConfig = {
  priorAlpha: 1,
  priorBeta: 1,
  missWeight: 1,
  retireThreshold: 0.35,
  activateThreshold: 0.5,
  minCleanToRetire: 3,
  moderateAt: 0.34,
  severeAt: 0.67,
};
