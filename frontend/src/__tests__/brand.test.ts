import { describe, it, expect } from "vitest";
import {
  PRODUCT_NAME,
  MASCOT_NAME,
  TAGLINE,
  TAGLINE_TA,
  BRAND_CONFIG,
} from "../brand";

describe("Brand Configuration Single Source of Truth", () => {
  it("exports valid platform brand name", () => {
    expect(PRODUCT_NAME).toBeDefined();
    expect(typeof PRODUCT_NAME).toBe("string");
    expect(PRODUCT_NAME.length).toBeGreaterThan(0);
  });

  it("exports valid mascot name following hyphenated AI convention", () => {
    expect(MASCOT_NAME).toBeDefined();
    expect(MASCOT_NAME).toContain("-AI");
  });

  it("exports approved taglines matching specification", () => {
    expect(TAGLINE).toBe("Study smart.");
    expect(TAGLINE_TA).toBe("Padikka vaa. Progress panna po!");
  });

  it("provides complete brand config object matching single source of truth", () => {
    expect(BRAND_CONFIG.name).toBe(PRODUCT_NAME);
    expect(BRAND_CONFIG.mascot).toBe(MASCOT_NAME);
    expect(BRAND_CONFIG.tagline).toBe(TAGLINE);
    expect(BRAND_CONFIG.taglineTa).toBe(TAGLINE_TA);
    expect(BRAND_CONFIG.version).toBe("0.1.0");
  });
});
