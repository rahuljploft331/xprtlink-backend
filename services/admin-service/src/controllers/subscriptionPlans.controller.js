import { getDb } from "@xprtlink/shared/db/index.js";
import { badRequest, notFound } from "@xprtlink/shared/utils/errors.js";
import { logAdminAction } from "#utils/audit.js";
import { assertUuid, billingPost } from "#utils/billingClient.js";

// Lowercase letters, digits, "." and "_" — valid on both App Store and Play Store.
const STORE_PRODUCT_ID_RE = /^[a-z0-9][a-z0-9._]{2,99}$/;

export const list = async (req, res) => {
  const db = getDb();
  const data = await db.subscriptionPlan.findMany({
    orderBy: { priceMonthlyCents: "asc" },
  });
  return data;
};

export const getById = async (req, res) => {
  const db = getDb();
  const data = await db.subscriptionPlan.findUnique({
    where: { id: req.params.id },
  });
  if (!data) throw notFound("subscriptionPlanNotFound");
  return data;
};

export const update = async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { code, name, tagline, priceMonthlyCents, visibilityBoost, keyFeatures, isActive, isMostPopular, maxBanners, bannerUploadEnabled, bannerFrequency, availableOnApp, availableOnWeb } = req.body;

  if (bannerFrequency !== undefined && !["monthly", "weekly"].includes(bannerFrequency)) {
    throw badRequest("validationFailed");
  }
  if (maxBanners !== undefined && (!Number.isInteger(maxBanners) || maxBanners < 0)) {
    throw badRequest("validationFailed");
  }

  const exists = await db.subscriptionPlan.findUnique({ where: { id } });
  if (!exists) throw notFound("subscriptionPlanNotFound");

  // The code doubles as the App Store / Play Store product ID, so an app-enabled plan
  // must have one that can exist there (a bad ID makes every purchase of it fail).
  const effectiveCode = code ?? exists.code;
  const effectiveOnApp = availableOnApp ?? exists.availableOnApp;
  if (effectiveOnApp && !STORE_PRODUCT_ID_RE.test(effectiveCode)) {
    throw badRequest("invalidStoreProductId", "INVALID_STORE_PRODUCT_ID", "code");
  }

  const data = await db.subscriptionPlan.update({
    where: { id },
    data: {
      code,
      name,
      tagline,
      priceMonthlyCents,
      visibilityBoost,
      keyFeatures,
      isActive,
      isMostPopular,
      maxBanners,
      bannerUploadEnabled,
      bannerFrequency,
      availableOnApp,
      availableOnWeb,
    },
  });

  return data;
};

/** Website price + free-trial days. Goes through billing-service, which owns the Stripe Price. */
export const updateWebPricing = async (req, res) => {
  const id = assertUuid(req.params.id);
  const { webPriceMonthlyCents, webTrialDays } = req.body ?? {};
  if (webPriceMonthlyCents === undefined && webTrialDays === undefined) throw badRequest("validationFailed");
  const result = await billingPost(`/admin/plans/${id}/web-pricing`, { webPriceMonthlyCents, webTrialDays });
  await logAdminAction(req, "subscriptionPlan.webPricing", "SubscriptionPlan", id, { webPriceMonthlyCents, webTrialDays });
  return result?.data ?? result;
};
