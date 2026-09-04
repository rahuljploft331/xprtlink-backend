import { getDb } from "@xprtlink/shared/db/index.js";
import { notFound } from "@xprtlink/shared/utils/errors.js";

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
  if (!data) throw notFound("Subscription Plan not found");
  return data;
};

export const update = async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { code, name, tagline, description, priceMonthlyCents, visibilityBoost, keyFeatures, isActive, isMostPopular } = req.body;

  const exists = await db.subscriptionPlan.findUnique({ where: { id } });
  if (!exists) throw notFound("Subscription Plan not found");

  const data = await db.subscriptionPlan.update({
    where: { id },
    data: {
      code,
      name,
      tagline,
      description,
      priceMonthlyCents,
      visibilityBoost,
      keyFeatures,
      isActive,
      isMostPopular,
    },
  });

  return data;
};
