import { generatePresignedDownloadUrl } from "../utils/s3.js";
import { resolveMediaUrl, toIso } from "./common.js";

export function toConversationSummaryDto(
  conversation,
  { peerName, peerAvatarUrl, unreadCount, lastMessage }
) {
  return {
    id: conversation.id,
    expertId: conversation.expertId,
    customerId: conversation.customerId,
    peerName,
    peerAvatarUrl,
    lastMessagePreview: lastMessage?.body ?? null,
    lastMessageAt: toIso(conversation.lastMessageAt),
    unreadCount,
  };
}

export async function toMessageDto(message, attachments = []) {
  const mappedAttachments = await Promise.all(
    attachments.map(async (a) => {
      let url = null;
      if (a.media?.storageKey) {
        url = await generatePresignedDownloadUrl(a.media.storageKey);
        if (!url) {
          url = resolveMediaUrl(a.media.storageKey);
        }
      }

      return {
        mediaId: a.mediaId,
        url,
        mimeType: a.media?.mimeType ?? null,
        sizeBytes: a.media?.sizeBytes ?? null,
        purpose: a.media?.purpose ?? null,
      };
    })
  );

  return {
    id: message.id,
    conversationId: message.conversationId,
    senderUserId: message.senderUserId,
    body: message.body,
    type: message.type,
    deliveryStatus: message.deliveryStatus,
    attachments: mappedAttachments,
    createdAt: toIso(message.createdAt),
  };
}
