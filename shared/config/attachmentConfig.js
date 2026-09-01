import { badRequest } from "../utils/errors.js";

/**
 * Returns attachment limits and allowed formats for Document, Image, Video
 * loaded from environment variables with sensible defaults.
 */
export function getChatAttachmentConfig() {
  const imageMimes = (
    process.env.CHAT_ATTACHMENT_IMAGE_MIMES ||
    "image/jpeg,image/png,image/webp,image/gif,image/heic"
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const imageMaxSizeMb = parseFloat(
    process.env.CHAT_ATTACHMENT_IMAGE_MAX_SIZE_MB || "10"
  );

  const docMimes = (
    process.env.CHAT_ATTACHMENT_DOC_MIMES ||
    "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv"
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const docMaxSizeMb = parseFloat(
    process.env.CHAT_ATTACHMENT_DOC_MAX_SIZE_MB || "15"
  );

  const videoMimes = (
    process.env.CHAT_ATTACHMENT_VIDEO_MIMES ||
    "video/mp4,video/quicktime,video/webm,video/x-matroska,video/3gpp"
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const videoMaxSizeMb = parseFloat(
    process.env.CHAT_ATTACHMENT_VIDEO_MAX_SIZE_MB || "50"
  );

  // Client decision (31 Aug 2026 call, §3.3): standard customer<->expert chat does
  // NOT support image or video. Media belongs to the Quote Request workflow, which
  // uploads under the separate `quote_attachment` purpose and is unaffected by this
  // config. Kept as a flag rather than deleted so the decision is reversible without
  // a code change; documents are untouched either way.
  const allowMedia = process.env.CHAT_ATTACHMENT_ALLOW_MEDIA === "true";

  return {
    image: {
      enabled: allowMedia,
      mimes: allowMedia ? imageMimes : [],
      maxSizeMb: imageMaxSizeMb,
      maxSizeBytes: Math.round(imageMaxSizeMb * 1024 * 1024),
    },
    document: {
      enabled: true,
      mimes: docMimes,
      maxSizeMb: docMaxSizeMb,
      maxSizeBytes: Math.round(docMaxSizeMb * 1024 * 1024),
    },
    video: {
      enabled: allowMedia,
      mimes: allowMedia ? videoMimes : [],
      maxSizeMb: videoMaxSizeMb,
      maxSizeBytes: Math.round(videoMaxSizeMb * 1024 * 1024),
    },
  };
}

/**
 * Validates mimeType and sizeBytes against Document, Image, Video rules.
 * @param {string} mimeType
 * @param {number} [sizeBytes]
 * @returns {{ valid: boolean, category: 'image' | 'document' | 'video', config: { mimes: string[], maxSizeMb: number, maxSizeBytes: number } }}
 */
export function validateChatAttachment(mimeType, sizeBytes) {
  if (!mimeType) {
    throw badRequest("MIME type is required for chat attachments", "INVALID_MIME_TYPE");
  }

  const normalizedMime = mimeType.trim().toLowerCase();
  const config = getChatAttachmentConfig();

  let category = null;
  if (normalizedMime.startsWith("image/") || config.image.mimes.includes(normalizedMime)) {
    category = "image";
  } else if (normalizedMime.startsWith("video/") || config.video.mimes.includes(normalizedMime)) {
    category = "video";
  } else {
    category = "document";
  }

  const catConfig = config[category];

  // Media is disabled for standard chat (§3.3). Fail with a message that points at
  // the right workflow rather than the generic "allowed formats: <empty>" below.
  if (catConfig.enabled === false) {
    throw badRequest(
      `${category === "video" ? "Video" : "Image"} attachments are not supported in chat. Share photos or videos through a Quote Request instead.`,
      "CHAT_MEDIA_NOT_ALLOWED"
    );
  }

  // Check allowed format
  if (!catConfig.mimes.includes(normalizedMime)) {
    throw badRequest(
      `File format '${mimeType}' is not supported for ${category} attachments. Allowed formats: ${catConfig.mimes.join(", ")}`,
      "UNSUPPORTED_MEDIA_TYPE"
    );
  }

  // Check file size limit
  if (sizeBytes != null && sizeBytes > catConfig.maxSizeBytes) {
    throw badRequest(
      `File size (${(sizeBytes / (1024 * 1024)).toFixed(2)} MB) exceeds maximum allowed limit of ${catConfig.maxSizeMb} MB for ${category} attachments`,
      "FILE_TOO_LARGE"
    );
  }

  return { valid: true, category, config: catConfig };
}

/**
 * Whether standard chat currently accepts image/video attachments.
 * False by default per the 31 Aug 2026 client decision (§3.3).
 */
export function isChatMediaAllowed() {
  return process.env.CHAT_ATTACHMENT_ALLOW_MEDIA === "true";
}
