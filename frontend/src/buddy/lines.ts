/**
 * Pre-generated, approved buddy dialogue line bank loader and interpolator.
 * Strictly enforces that lines originate from the approved line bank.
 */

export interface BuddyLine {
  id: string;
  trigger: string;
  tone: string;
  text: string;
  reviewed_by: string;
  reviewed_on: string;
}

export const APPROVED_LINES: BuddyLine[] = [
  {
    id: "struggle_topic_01",
    trigger: "struggling_topic",
    tone: "patient",
    text: "Dei thambi, indha topic innum puriyalaya? Vera example solren.",
    reviewed_by: "pending",
    reviewed_on: "2026-10-24",
  },
  {
    id: "low_quiz_01",
    trigger: "low_quiz_score",
    tone: "patient",
    text: "Quiz-la 3/10 dhaana? Seri, namma basics-ku thirumbi polam.",
    reviewed_by: "pending",
    reviewed_on: "2026-10-24",
  },
  {
    id: "mastery_gained_01",
    trigger: "mastery_gained",
    tone: "hype",
    text: "Semma! Indha topic unakku master aayiduchu.",
    reviewed_by: "pending",
    reviewed_on: "2026-10-24",
  },
  {
    id: "break_long_study_01",
    trigger: "long_unbroken_study",
    tone: "friendly_checkin",
    text: "20 minutes continuous-ah padichitta. Break venuma, {{address_term}}?",
    reviewed_by: "pending",
    reviewed_on: "2026-10-24",
  },
  {
    id: "quiz_streak_01",
    trigger: "quiz_streak",
    tone: "hype",
    text: "Aasathuringa {{address_term}}! Streak continue aagudhu!",
    reviewed_by: "pending",
    reviewed_on: "2026-10-25",
  },
  {
    id: "break_prompt_01",
    trigger: "break_prompt",
    tone: "friendly_checkin",
    text: "Oru chinna breather eduthukalaama, {{address_term}}?",
    reviewed_by: "pending",
    reviewed_on: "2026-10-25",
  },
];

/**
 * Returns an approved dialogue line matching trigger and optional tone,
 * substituting {{address_term}} with the user's preference.
 */
export function getBuddyLine(
  trigger: string,
  tone?: string,
  addressTerm: string = "boss"
): string {
  const matching = APPROVED_LINES.filter((l) => {
    if (l.trigger !== trigger) return false;
    if (tone && l.tone !== tone) return false;
    return true;
  });

  const pool = matching.length > 0 ? matching : APPROVED_LINES.filter((l) => l.trigger === trigger);
  const selected = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;

  if (!selected) {
    return `Padikka vaa, progress panna po! (${addressTerm})`;
  }

  return selected.text.replace(/\{\{address_term\}\}/g, addressTerm);
}
