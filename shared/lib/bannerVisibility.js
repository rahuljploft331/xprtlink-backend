/**
 * The one rule for "a customer may see this banner": admin-approved, switched on,
 * owned by a verified active expert whose subscription is active, not past its
 * period end, and on a plan that still includes banners. Used by the home feed,
 * the expert profile and the admin "live" count so they can never disagree.
 */
export function liveBannerWhere(now = new Date()) {
  return {
    isActive: true,
    approvalStatus: "approved",
    expert: {
      verificationStatus: "approved",
      user: { status: "active" },
      subscriptions: {
        some: {
          status: "active",
          currentPeriodEnd: { gt: now },
          plan: { bannerUploadEnabled: true },
        },
      },
    },
  };
}
