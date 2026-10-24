import { getDb } from "@xprtlink/shared/db/index.js";
import { badRequest, notFound } from "@xprtlink/shared/utils/errors.js";
import { logAdminAction } from "#utils/audit.js";
import { assertUuid, billingPost } from "#utils/billingClient.js";

// Lowercase letters, digits, "." and "_" — valid on both App Store and Play Store.
const STORE_PRODUCT_ID_RE = /^[a-z0-9][a-z0-9._]{2,99}$/;
const PLAN_CODE_RE = /^[a-z0-9][a-z0-9_]{1,31}$/;

/** undefined = leave unchanged; "" / null = web-only (hidden from mobile); else a validated ID. */
function normalizeStoreId(value) {
  if (value === undefined) return undefined;
  const v = typeof value === "string" ? value.trim() : "";
  if (!v) return null;
  if (!STORE_PRODUCT_ID_RE.test(v)) throw badRequest("invalidStoreProductId", "INVALID_STORE_PRODUCT_ID", "storeProductId");
  return v;
}

async function assertStoreIdFree(db, storeId, exceptId) {
  const clash = await db.subscriptionPlan.findFirst({ where: { storeProductId: storeId, NOT: exceptId ? { id: exceptId } : undefined }, select: { id: true } });
  if (clash) throw badRequest("storeProductIdInUse", "STORE_PRODUCT_ID_IN_USE", "storeProductId");
}

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
  const { code, name, tagline, priceMonthlyCents, visibilityBoost, keyFeatures, isActive, isMostPopular, maxBanners, bannerUploadEnabled, bannerFrequency, storeProductId, availableOnWeb } = req.body;

  if (bannerFrequency !== undefined && !["monthly", "weekly"].includes(bannerFrequency)) {
    throw badRequest("validationFailed");
  }
  if (maxBanners !== undefined && (!Number.isInteger(maxBanners) || maxBanners < 0)) {
    throw badRequest("validationFailed");
  }

  const exists = await db.subscriptionPlan.findUnique({ where: { id } });
  if (!exists) throw notFound("subscriptionPlanNotFound");

  const storeId = normalizeStoreId(storeProductId);
  if (storeId) await assertStoreIdFree(db, storeId, id);

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
      storeProductId: storeId,
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

/** Create a plan. Web price (optional) is applied via billing so the Stripe Price exists before it is shown. */
export const create = async (req, res) => {
  const db = getDb();
  const { name, code, tagline, priceMonthlyCents, visibilityBoost, keyFeatures, isMostPopular, maxBanners, bannerUploadEnabled, bannerFrequency, storeProductId, availableOnWeb, webPriceMonthlyCents, webTrialDays } = req.body ?? {};

  if (!name || typeof name !== "string" || !name.trim()) throw badRequest("validationFailed", "VALIDATION_FAILED", "name");
  if (typeof code !== "string" || !PLAN_CODE_RE.test(code.trim())) throw badRequest("invalidPlanCode", "INVALID_PLAN_CODE", "code");
  if (!["listing", "top_25", "top_5"].includes(visibilityBoost)) throw badRequest("validationFailed", "VALIDATION_FAILED", "visibilityBoost");
  if (!Number.isInteger(priceMonthlyCents) || priceMonthlyCents < 0) throw badRequest("validationFailed", "VALIDATION_FAILED", "priceMonthlyCents");
  if (bannerFrequency !== undefined && !["monthly", "weekly"].includes(bannerFrequency)) throw badRequest("validationFailed");
  if (maxBanners !== undefined && (!Number.isInteger(maxBanners) || maxBanners < 0)) throw badRequest("validationFailed");

  const cleanCode = code.trim();
  if (await db.subscriptionPlan.findUnique({ where: { code: cleanCode } })) throw badRequest("planCodeInUse", "PLAN_CODE_IN_USE", "code");
  const storeId = normalizeStoreId(storeProductId) ?? null;
  if (storeId) await assertStoreIdFree(db, storeId);

  const plan = await db.subscriptionPlan.create({
    data: {
      name: name.trim(),
      code: cleanCode,
      tagline,
      priceMonthlyCents,
      visibilityBoost,
      keyFeatures: Array.isArray(keyFeatures) ? keyFeatures : [],
      isMostPopular: isMostPopular ?? false,
      maxBanners: maxBanners ?? 0,
      bannerUploadEnabled: bannerUploadEnabled ?? false,
      bannerFrequency: bannerFrequency ?? "monthly",
      storeProductId: storeId,
      availableOnWeb: availableOnWeb ?? true,
      isActive: true,
    },
  });

  let result = plan;
  if (webPriceMonthlyCents !== undefined || webTrialDays !== undefined) {
    try {
      const out = await billingPost(`/admin/plans/${plan.id}/web-pricing`, { webPriceMonthlyCents, webTrialDays });
      result = out?.data ?? out;
    } catch (err) {
      // No half-created plan: without its Stripe Price the website could not sell it.
      await db.subscriptionPlan.delete({ where: { id: plan.id } }).catch(() => {});
      throw err;
    }
  }
  await logAdminAction(req, "subscriptionPlan.create", "SubscriptionPlan", plan.id, { code: cleanCode, storeProductId: storeId, webPriceMonthlyCents, webTrialDays });
  return result;
};
