import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getDb } from "@xprtlink/shared/db";
import { toMediaAssetDto } from "@xprtlink/shared/mappers/media.mapper.js";
import { forbidden, notFound, badRequest } from "@xprtlink/shared/utils/errors.js";
import {
  getChatAttachmentConfig,
  validateChatAttachment,
} from "@xprtlink/shared/config/attachmentConfig.js";

function buildUploadUrl(storageKey) {
  const base =
    process.env.MEDIA_UPLOAD_BASE_URL || "https://upload.stub.xprtlink.local";
  return `${base.replace(/\/$/, "")}/${storageKey}?stub=1`;
}

function buildStorageKey(userId, purpose, assetId, ext = "") {
  return `${userId}/${purpose}/${assetId}${ext}`;
}

export function getAttachmentSettings() {
  return getChatAttachmentConfig();
}

export async function createUpload(auth, body) {
  if (body.purpose === "chat_attachment") {
    validateChatAttachment(body.mimeType, body.sizeBytes);
  }

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
  const ext = fileName && fileName.includes(".") ? path.extname(fileName) : "";
  const storageKey = buildStorageKey(auth.userId, purpose, assetId, ext);

  // Save file locally in uploads folder
  const uploadDir = path.resolve(process.cwd(), "uploads", auth.userId, purpose);
  fs.mkdirSync(uploadDir, { recursive: true });
  const filePath = path.join(uploadDir, `${assetId}${ext}`);

  let computedSize = sizeBytes || 0;
  if (base64Data) {
    const rawData = base64Data.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(rawData, "base64");
    fs.writeFileSync(filePath, buffer);
    computedSize = buffer.length;

    // Double check file size after decoding
    if (purpose === "chat_attachment") {
      validateChatAttachment(mimeType, computedSize);
    }
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
