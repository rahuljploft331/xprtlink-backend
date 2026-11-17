import { describe, expect, it } from "vitest";
import { parseWebsitePlansEnabled } from "./websitePlans.js";

describe("parseWebsitePlansEnabled", () => {
  it("defaults to on when the row is missing", () => {
    expect(parseWebsitePlansEnabled(undefined)).toBe(true);
    expect(parseWebsitePlansEnabled(null)).toBe(true);
  });
  it("is off only for an explicit false", () => {
    expect(parseWebsitePlansEnabled(false)).toBe(false);
    expect(parseWebsitePlansEnabled("false")).toBe(false);
    expect(parseWebsitePlansEnabled(0)).toBe(false);
    expect(parseWebsitePlansEnabled(true)).toBe(true);
    expect(parseWebsitePlansEnabled("true")).toBe(true);
  });
});
