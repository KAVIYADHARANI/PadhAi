/**
 * Quality Gate for Study Buddy v2.
 *
 * Implements README Section 11.2:
 * "Quality gate: if landmarks are unreliable (low light, face partly out of frame, glare),
 * drop to presence-only and stop judging drowsiness.
 * Say 'I can't see you well, I'll stay quiet' rather than guessing."
 */

export interface QualityGateDecision {
  passed: boolean;
  qualityScore: number;
  effectiveStudyMode: "screen" | "book_notes" | "presence_only" | "camera_off";
  shouldSilenceDrowsiness: boolean;
  quietMessage: string | null;
}

export const MIN_QUALITY_SCORE = 40;

export function evaluateQualityGate(
  qualityScore: number,
  facePresent: boolean,
  requestedMode: "screen" | "book_notes" | "presence_only" | "camera_off"
): QualityGateDecision {
  if (requestedMode === "camera_off") {
    return {
      passed: true,
      qualityScore: 100,
      effectiveStudyMode: "camera_off",
      shouldSilenceDrowsiness: true,
      quietMessage: null,
    };
  }

  if (requestedMode === "presence_only") {
    return {
      passed: true,
      qualityScore,
      effectiveStudyMode: "presence_only",
      shouldSilenceDrowsiness: true,
      quietMessage: null,
    };
  }

  // If face is present but quality is below threshold (poor lighting, glare, cut off)
  if (facePresent && qualityScore < MIN_QUALITY_SCORE) {
    return {
      passed: false,
      qualityScore,
      effectiveStudyMode: "presence_only",
      shouldSilenceDrowsiness: true,
      quietMessage: "I can't see you well in this light, so I'll stay quiet and keep time.",
    };
  }

  return {
    passed: true,
    qualityScore,
    effectiveStudyMode: requestedMode,
    shouldSilenceDrowsiness: false,
    quietMessage: null,
  };
}
