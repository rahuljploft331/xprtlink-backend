import { resolveMediaUrl, toIso } from "./common.js";

export function toConversationSummaryDto(conversation, { peerName, peerAvatarUrl, unreadCount, lastMessage }) {
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

export function toMessageDto(message, attachments = []) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderUserId: message.senderUserId,
    body: message.body,
    type: message.type,
    deliveryStatus: message.deliveryStatus,
    attachments: attachments.map((a) => ({
      mediaId: a.mediaId,
      url: resolveMediaUrl(a.media?.storageKey),
      mimeType: a.media?.mimeType ?? null,
    })),
    createdAt: toIso(message.createdAt),
  };
}
