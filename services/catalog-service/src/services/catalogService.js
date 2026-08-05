import { getDb } from "@xprtlink/shared/db";
import { toAppConfigDto, toCategoryDto, toCmsPageDto } from "@xprtlink/shared/mappers/media.mapper.js";
import { notFound } from "@xprtlink/shared/utils/errors.js";

export async function getAppConfig() {
  const db = getDb();
  const [config, settings] = await Promise.all([
    db.appConfig.findFirst({ orderBy: { updatedAt: "desc" } }),
    db.platformSetting.findMany(),
  ]);
  const platformSettings = Object.fromEntries(
    settings.map((s) => [s.key, s.value])
  );
  return toAppConfigDto(config, platformSettings);
}

export async function getCategories() {
  const rows = await getDb().category.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map(toCategoryDto);
}

export async function getCmsPage(slug) {
  const page = await getDb().cmsPage.findFirst({
    where: { slug, status: "published" },
  });
  if (!page) throw notFound("Page not found");
  return toCmsPageDto(page);
}
