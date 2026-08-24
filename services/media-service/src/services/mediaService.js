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
  const db = getDb();
  const asset = await db.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset) throw notFound("Media not found");
  if (asset.status === "deleted") throw notFound("Media not found");

  // Owner always has access
  if (asset.ownerUserId === auth.userId) {
    return toMediaAssetDto(asset);
  }

  // Relationship-based access: check if the requesting user is a participant
  // in a conversation, quote, or other context that references this media.
  const hasAccess = await checkRelationshipAccess(db, auth, asset);
  if (!hasAccess) throw forbidden("Access denied");

  return toMediaAssetDto(asset);
}

/**
 * Check if a non-owner user has legitimate access to a media asset
 * based on their relationship to the resource that references it.
 */
async function checkRelationshipAccess(db, auth, asset) {
  // Avatars (expert or customer) are publicly readable by any authenticated user
  if (asset.purpose === "avatar") return true;

  // Chat attachments: user must be a participant in the conversation containing this media
  if (asset.purpose === "chat_attachment") {
    const messageAttachment = await db.messageAttachment.findFirst({
      where: { mediaId: asset.id },
      include: { message: { select: { conversationId: true } } },
    });
    if (!messageAttachment) return false;

    const conversation = await db.conversation.findFirst({
      where: {
        id: messageAttachment.message.conversationId,
        OR: [
          { customer: { userId: auth.userId } },
          { expert: { userId: auth.userId } },
        ],
      },
    });
    return Boolean(conversation);
  }

  // Quote attachments: user must be a participant in the quote
  if (asset.purpose === "quote_attachment") {
    const quoteAttachment = await db.quoteAttachment.findFirst({
      where: { mediaId: asset.id },
      include: { quote: { select: { customerId: true, expertId: true } } },
    });
    if (!quoteAttachment) return false;

    const quote = quoteAttachment.quote;
    return (
      quote.customerId === auth.customerProfileId ||
      quote.expertId === auth.expertProfileId
    );
  }

  // Verification documents: only owner + admin
  if (asset.purpose === "verification_doc") {
    return auth.role === "super_admin" || auth.role === "subadmin";
  }

  // Default: deny
  return false;
}
