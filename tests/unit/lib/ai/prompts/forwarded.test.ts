/**
 * Forwarded-message prompt tests — A3 / Inv-16.
 *
 * Caps: ≤20 items per forward; ≤6000 chars passed to the LLM. Both
 * are enforced in the prompt template (and defensively in the
 * webhook router).
 */
import { describe, expect, it } from "vitest";

import {
  FORWARDED_MAX_ITEMS,
  FORWARDED_TEXT_MAX_CHARS,
  forwardedMessagePrompt,
} from "@/lib/ai/prompts/forwarded";

const baseInput = {
  userLocale: "tr",
  userFirstName: "Burak",
  userTimezone: "Europe/Istanbul",
  forwardedFrom: "Ali",
};

describe("forwardedMessagePrompt", () => {
  it("exposes Inv-16 caps as named constants", () => {
    expect(FORWARDED_MAX_ITEMS).toBe(20);
    expect(FORWARDED_TEXT_MAX_CHARS).toBe(6000);
  });

  it("includes the forwarded text verbatim when within the cap", () => {
    const text = "Süt al. Ekmek al. Ali'yi ara.";
    const out = forwardedMessagePrompt({ ...baseInput, forwardedText: text });
    expect(out).toContain(text);
    expect(out).not.toContain("[truncated]");
  });

  it("truncates forwarded text > 6000 chars and adds a marker", () => {
    const long = "x".repeat(FORWARDED_TEXT_MAX_CHARS + 500);
    const out = forwardedMessagePrompt({ ...baseInput, forwardedText: long });
    expect(out).toContain("[truncated]");
    // The full long string is NOT in the output.
    expect(out).not.toContain("x".repeat(FORWARDED_TEXT_MAX_CHARS + 1));
  });

  it("references the 20-item cap explicitly in the prompt body", () => {
    const out = forwardedMessagePrompt({ ...baseInput, forwardedText: "x" });
    expect(out).toContain(String(FORWARDED_MAX_ITEMS));
  });

  it("instructs single-purpose extraction (no other tools)", () => {
    const out = forwardedMessagePrompt({ ...baseInput, forwardedText: "x" });
    expect(out).toContain("create_item");
    // Other tool names are explicitly listed as DO NOT call.
    expect(out).toMatch(/search_items|update_item|complete_item|delete_item/);
  });

  it("includes user locale + timezone for downstream LLM context", () => {
    const out = forwardedMessagePrompt({
      ...baseInput,
      forwardedText: "x",
    });
    expect(out).toContain("tr");
    expect(out).toContain("Europe/Istanbul");
    expect(out).toContain("Burak");
  });
});
