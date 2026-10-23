/**
 * Frontend single source of truth for approved brand strings and identity constants.
 *
 * BRAND RULE:
 * Brand strings ('PadhAI', 'Parama-AI') must appear ONLY in this file on the frontend.
 * Every other UI component, page, or service must import from here.
 */

export const PRODUCT_NAME = "PadhAI";
export const MASCOT_NAME = "Parama-AI";
export const TAGLINE = "Study smart.";
export const TAGLINE_TA = "Padikka vaa. Progress panna po!";

export const BRAND_CONFIG = {
  name: PRODUCT_NAME,
  mascot: MASCOT_NAME,
  tagline: TAGLINE,
  taglineTa: TAGLINE_TA,
  version: "0.1.0",
} as const;
