import crypto from "crypto";
import path from "path";
import { getDb } from "@xprtlink/shared/db";
import { toMediaAssetDto } from "@xprtlink/shared/mappers/media.mapper.js";
import { forbidden, notFound, badRequest } from "@xprtlink/shared/utils/errors.js";
import {
  getChatAttachmentConfig,
  validateChatAttachment,
} from "@xprtlink/shared/config/attachmentConfig.js";
import {
  generatePresignedUploadUrl,
  generatePresignedDownloadUrl,
  uploadBufferToS3,
} from "@xprtlink/shared/utils/s3.js";

function getExtension(fileName, mimeType) {
  if (fileName && fileName.includes(".")) {
    return path.extname(fileName);
  }
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "application/pdf": ".pdf",
    "video/mp4": ".mp4",
    "video/quicktime": ".mov",
  };
  return map[mimeType] || "";
}

function buildTempStorageKey(userId, assetId, fileName, mimeType) {
  const ext = getExtension(fileName, mimeType);
  const cleanName = fileName ? path.basename(fileName) : `file${ext}`;
  return `temp/${userId}/${assetId}/${cleanName}`;
}

export function getAttachmentSettings() {
  return getChatAttachmentConfig();
}

/**
 * 1. Request Presigned Upload URL:
 * Client uploads directly to S3 under temp/<userId>/<assetId>/<fileName>.
 */
export async function createUpload(auth, body) {
  if (body.purpose === "chat_attachment") {
    validateChatAttachment(body.mimeType, body.sizeBytes);
  }

  const db = getDb();
  const assetId = crypto.randomUUID();
  const storageKey = buildTempStorageKey(auth.userId, assetId, body.fileName, body.mimeType);

  // Generate S3 Presigned PUT URL
  const uploadUrl = await generatePresignedUploadUrl(storageKey, body.mimeType);

  const asset = await db.mediaAsset.create({
    data: {
      id: assetId,
      ownerUserId: auth.userId,
      purpose: body.purpose || "chat_attachment",
      storageKey,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes || null,
      status: "pending_upload",
    },
  });

  return toMediaAssetDto(asset, { uploadUrl });
}

/**
 * Direct Upload (with Base64 payload streaming directly to S3 temp path).
 */
export async function directUpload(auth, body) {
  const { purpose = "chat_attachment", mimeType, fileName, base64Data, sizeBytes } = body;

  if (!mimeType) {
    throw badRequest("mimeType is required");
  }

  if (purpose === "chat_attachment") {
    validateChatAttachment(mimeType, sizeBytes);
  }

  const db = getDb();
  const assetId = crypto.randomUUID();
  const storageKey = buildTempStorageKey(auth.userId, assetId, fileName, mimeType);

  let computedSize = sizeBytes || 0;
  if (base64Data) {
    const rawData = base64Data.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(rawData, "base64");
    computedSize = buffer.length;

    // Validate size after buffer decoding
    if (purpose === "chat_attachment") {
      validateChatAttachment(mimeType, computedSize);
    }

    // Stream directly into AWS S3
    await uploadBufferToS3(storageKey, buffer, mimeType);
  }

  const asset = await db.mediaAsset.create({
    data: {
      id: assetId,
      ownerUserId: auth.userId,
      purpose,
      storageKey,
      mimeType,
      sizeBytes: computedSize,
      status: "ready",
    },
  });

  return toMediaAssetDto(asset);
}

/**
 * 2. Confirm Upload (Marks status as 'ready' after client puts file to S3).
 */
export async function confirmUpload(auth, assetId) {
  const db = getDb();
  const asset = await db.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw notFound("Media not found");
  if (asset.ownerUserId !== auth.userId) throw forbidden("Access denied");

  const updated = await db.mediaAsset.update({
    where: { id: assetId },
    data: { status: "ready" },
  });

  return toMediaAssetDto(updated);
}

export async function getMediaAsset(auth, assetId) {
  const asset = await getDb().mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw notFound("Media not found");
  if (asset.ownerUserId !== auth.userId) throw forbidden("Access denied");
  if (asset.status === "deleted") throw notFound("Media not found");

  return toMediaAssetDto(asset);
}
