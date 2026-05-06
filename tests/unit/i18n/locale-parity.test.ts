/**
 * Locale catalog completeness — Inv-19.
 *
 * Every key in messages/tr.json must exist in messages/en.json and
 * vice-versa. CI-checkable. If a Frontend or AI change touches one
 * catalog without updating the other, this test fails fast.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...flatten(v as Record<string, unknown>, path));
    } else {
      out.push(path);
    }
  }
  return out;
}

function load(locale: "tr" | "en"): Record<string, unknown> {
  const p = path.resolve(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(readFileSync(p, "utf8"));
}

describe("locale catalogs (Inv-19)", () => {
  const tr = load("tr");
  const en = load("en");
  const trKeys = new Set(flatten(tr));
  const enKeys = new Set(flatten(en));

  it("messages/tr.json and messages/en.json have identical key sets", () => {
    const missingInEn = [...trKeys].filter((k) => !enKeys.has(k)).sort();
    const missingInTr = [...enKeys].filter((k) => !trKeys.has(k)).sort();
    expect(missingInEn, "keys in TR but not EN").toEqual([]);
    expect(missingInTr, "keys in EN but not TR").toEqual([]);
  });

  it("both catalogs have at least 100 keys (sanity floor)", () => {
    expect(trKeys.size).toBeGreaterThanOrEqual(100);
    expect(enKeys.size).toBeGreaterThanOrEqual(100);
  });
});
