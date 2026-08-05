import crypto from "crypto";
import { getDb } from "@xprtlink/shared/db";
import { toMediaAssetDto } from "@xprtlink/shared/mappers/media.mapper.js";
import { forbidden, notFound } from "@xprtlink/shared/utils/errors.js";

function buildUploadUrl(storageKey) {
  const base =
    process.env.MEDIA_UPLOAD_BASE_URL || "https://upload.stub.xprtlink.local";
  return `${base.replace(/\/$/, "")}/${storageKey}?stub=1`;
}

function buildStorageKey(userId, purpose, assetId) {
  return `${userId}/${purpose}/${assetId}`;
}

export async function createUpload(auth, body) {
  const db = getDb();
  const assetId = crypto.randomUUID();
  const storageKey = buildStorageKey(auth.userId, body.purpose, assetId);

  const asset = await db.mediaAsset.create({
    data: {
      id: assetId,
      ownerUserId: auth.userId,
      purpose: body.purpose,
      storageKey,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      status: "pending_upload",
    },
  });

  const uploadUrl = buildUploadUrl(storageKey);
  return toMediaAssetDto(asset, { uploadUrl });
}

export async function getMediaAsset(auth, assetId) {
  const asset = await getDb().mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw notFound("Media not found");
  if (asset.ownerUserId !== auth.userId) throw forbidden("Access denied");
  if (asset.status === "deleted") throw notFound("Media not found");

  return toMediaAssetDto(asset);
}
