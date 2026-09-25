import { generatePresignedDownloadUrl } from "../utils/s3.js";
import { resolveMediaUrl, toIso } from "./common.js";

export function toConversationSummaryDto(
  conversation,
  { peerName, peerAvatarUrl, unreadCount, lastMessage, isBlocked, blockedByMe }
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
    isBlocked: isBlocked ?? false,
    blockedByMe: blockedByMe ?? false,
  };
}

/**
 * The `conversation:join` ack. Carries the block state and the peer's details
 * so a thread opened from a shortcut (which passes only a conversation id, no
 * block flags and no peer profile) can lock its composer and render the peer
 * header without a second round-trip.
 */
export function toConversationJoinDto(
  conversation,
  { isBlocked, blockedByMe, peer }
) {
  return {
    conversationId: conversation.id,
    joined: true,
    isBlocked: isBlocked ?? false,
    blockedByMe: blockedByMe ?? false,
    isBlockedByPeer: (isBlocked ?? false) && !(blockedByMe ?? false),
    peer: peer ?? null,
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
