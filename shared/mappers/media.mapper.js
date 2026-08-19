import { generatePresignedDownloadUrl } from "../utils/s3.js";
import { resolveMediaUrl, toIso } from "./common.js";

export async function toMediaAssetDto(asset, { uploadUrl } = {}) {
  let url = null;
  if (asset.status === "ready" && asset.storageKey) {
    url = await generatePresignedDownloadUrl(asset.storageKey);
    if (!url) url = resolveMediaUrl(asset.storageKey);
  }

  return {
    id: asset.id,
    purpose: asset.purpose,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    status: asset.status,
    ...(uploadUrl ? { uploadUrl } : {}),
    url,
    createdAt: toIso(asset.createdAt),
  };
}

export function toAppConfigDto(config, platformSettings = {}) {
  return {
    minAppVersion: config?.minAppVersion ?? "1.0.0",
    forceUpdate: config?.forceUpdate ?? false,
    maintenanceMode: platformSettings.maintenanceMode ?? false,
    maintenanceMessage: config?.maintenanceMessage ?? null,
  };
}

export function toCategoryDto(category) {
  return {
    id: category.id,
    slug: category.slug,
    name: category.name,
    sortOrder: category.sortOrder,
  };
}

export function toCmsPageDto(page) {
  return {
    slug: page.slug,
    title: page.title,
    bodyHtml: page.bodyHtml,
    publishedAt: toIso(page.publishedAt),
  };
}
