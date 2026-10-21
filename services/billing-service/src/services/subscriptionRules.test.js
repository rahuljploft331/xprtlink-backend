import { describe, expect, it } from "vitest";
import { comparePlans, evaluatePlanChange, hasActiveEntitlement, PLAN_CHANGE } from "./subscriptionRules.js";

describe("plan hierarchy", () => {
  it.each([
    ["core", "professional"],
    ["core", "elite"],
    ["professional", "elite"],
  ])("%s → %s is an allowed upgrade", (from, to) => {
    const v = evaluatePlanChange(from, to);
    expect(v.allowed).toBe(true);
    expect(v.relation).toBe(PLAN_CHANGE.UPGRADE);
  });

  it.each([
    ["professional", "core"],
    ["elite", "professional"],
    ["elite", "core"],
  ])("%s → %s is blocked as a downgrade", (from, to) => {
    const v = evaluatePlanChange(from, to);
    expect(v.allowed).toBe(false);
    expect(v.code).toBe("SUBSCRIPTION_DOWNGRADE_BLOCKED");
  });

  it("same plan is blocked as already active", () => {
    const v = evaluatePlanChange("elite", "Elite");
    expect(v.allowed).toBe(false);
    expect(v.code).toBe("SUBSCRIPTION_ALREADY_ACTIVE");
  });

  it("no current plan is a new purchase; unknown codes fail open", () => {
    expect(comparePlans(null, "core")).toBe(PLAN_CHANGE.NEW);
    expect(evaluatePlanChange("custom", "elite").allowed).toBe(true);
  });
});

describe("hasActiveEntitlement", () => {
  const future = new Date(Date.now() + 86400000);
  const past = new Date(Date.now() - 86400000);
  it("treats cancel-at-period-end (status active, future end) as entitled", () => {
    expect(hasActiveEntitlement({ status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: future })).toBe(true);
  });
  it("expired / canceled / lapsed rows are not entitled", () => {
    expect(hasActiveEntitlement({ status: "expired", currentPeriodEnd: future })).toBe(false);
    expect(hasActiveEntitlement({ status: "canceled", currentPeriodEnd: future })).toBe(false);
    expect(hasActiveEntitlement({ status: "active", currentPeriodEnd: past })).toBe(false);
  });
  it("grace period extends entitlement to gracePeriodEnd", () => {
    expect(hasActiveEntitlement({ status: "grace_period", currentPeriodEnd: past, gracePeriodEnd: future })).toBe(true);
  });
});
