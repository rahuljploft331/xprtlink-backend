import { describe, expect, it } from "vitest";
import { liveBannerWhere } from "./bannerVisibility.js";

describe("liveBannerWhere", () => {
  it("only matches approved, active banners of entitled experts with an unexpired banner plan", () => {
    const now = new Date("2026-11-17T00:00:00Z");
    const w = liveBannerWhere(now);
    expect(w.isActive).toBe(true);
    expect(w.approvalStatus).toBe("approved");
    expect(w.expert.verificationStatus).toBe("approved");
    expect(w.expert.user).toEqual({ status: "active" });
    expect(w.expert.subscriptions.some).toEqual({
      status: "active",
      currentPeriodEnd: { gt: now },
      plan: { bannerUploadEnabled: true },
    });
  });
});
