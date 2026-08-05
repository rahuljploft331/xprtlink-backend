import { resolveMediaUrl, toIso } from "./common.js";

export function toMediaAssetDto(asset, { uploadUrl } = {}) {
  return {
    id: asset.id,
    purpose: asset.purpose,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    status: asset.status,
    ...(uploadUrl ? { uploadUrl } : {}),
    url: asset.status === "ready" ? resolveMediaUrl(asset.storageKey) : null,
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
