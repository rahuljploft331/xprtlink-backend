import { getMessage } from "@xprtlink/shared/utils/messages.js";
import { getDb } from "@xprtlink/shared/db";
import { moveS3Object } from "@xprtlink/shared/utils/s3.js";
import { customerDisplayName, resolveMediaUrl } from "@xprtlink/shared/mappers/common.js";
import { expertDisplayName } from "@xprtlink/shared/mappers/expert.mapper.js";
import {
  toConversationSummaryDto,
  toMessageDto,
} from "@xprtlink/shared/mappers/messaging.mapper.js";
import { isChatMediaAllowed } from "@xprtlink/shared/config/attachmentConfig.js";
import { badRequest, forbidden, notFound } from "@xprtlink/shared/utils/errors.js";
import { parsePagination, paginatedResult } from "@xprtlink/shared/utils/pagination.js";

function conversationWhere(auth) {
  if (auth.role === "customer") {
    return { customerId: auth.customerProfileId };
  }
  if (auth.role === "expert") {
    return { expertId: auth.expertProfileId };
  }
  throw forbidden("messagingRequiresRole");
}

export async function loadConversation(auth, conversationId) {
  const conversation = await getDb().conversation.findFirst({
    where: { id: conversationId, ...conversationWhere(auth) },
    include: {
      customer: { include: { user: true } },
      expert: true,
    },
  });
  if (!conversation) throw notFound("conversationNotFound");
  return conversation;
}

export async function getConversationPeerUserId(conversationId, currentUserId) {
  const conversation = await getDb().conversation.findUnique({
    where: { id: conversationId },
    include: {
      customer: { select: { userId: true } },
      expert: { select: { userId: true } },
    },
  });
  if (!conversation) return null;
  if (conversation.customer?.userId === currentUserId) {
    return conversation.expert?.userId ?? null;
  }
  return conversation.customer?.userId ?? null;
}

export async function getConversationSenderInfo(conversationId, auth) {
  const conversation = await loadConversation(auth, conversationId);
  if (auth.role === "customer") {
    return {
      name: customerDisplayName(conversation.customer?.user, conversation.customer) || "Customer",
      avatarUrl: resolveMediaUrl(conversation.customer?.avatarMedia?.storageKey),
    };
  }
  return {
    name: expertDisplayName(conversation.expert) || "Expert",
    avatarUrl: resolveMediaUrl(conversation.expert?.avatarMedia?.storageKey),
  };
}

async function countUnreadMessages(conversationId, userId, lastReadMessage) {
  return getDb().message.count({
    where: {
      conversationId,
      senderUserId: { not: userId },
      ...(lastReadMessage
        ? { createdAt: { gt: lastReadMessage.createdAt } }
        : {}),
    },
  });
}

function peerInfo(conversation, auth) {
  if (auth.role === "customer") {
    const avatarMedia = conversation.expert?.avatarMedia;
    return {
      peerName: expertDisplayName(conversation.expert),
      peerAvatarUrl: resolveMediaUrl(avatarMedia?.storageKey),
    };
  }
  return {
    peerName: customerDisplayName(conversation.customer?.user, conversation.customer),
    peerAvatarUrl: resolveMediaUrl(conversation.customer?.avatarMedia?.storageKey),
  };
}

export async function listConversations(auth, query) {
  const { page, limit, skip } = parsePagination(query);
  const db = getDb();

  const [rows, total] = await Promise.all([
    db.conversation.findMany({
      where: conversationWhere(auth),
      orderBy: { lastMessageAt: "desc" },
      skip,
      take: limit,
      include: {
        customer: { include: { user: true, avatarMedia: true } },
        expert: { include: { avatarMedia: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
        readStates: {
          where: { userId: auth.userId },
          include: { lastReadMessage: true },
        },
      },
    }),
    db.conversation.count({ where: conversationWhere(auth) }),
  ]);

  // Fetch block status
  const otherUserIds = rows.map(c => auth.role === 'customer' ? c.expert?.userId : c.customer?.userId).filter(Boolean);
  const blocks = otherUserIds.length ? await db.userBlock.findMany({
    where: {
      OR: [
        { blockerUserId: auth.userId, blockedUserId: { in: otherUserIds } },
        { blockerUserId: { in: otherUserIds }, blockedUserId: auth.userId }
      ]
    }
  }) : [];
  
  const blockMap = {};
  for (const block of blocks) {
    if (block.blockerUserId === auth.userId) {
      blockMap[block.blockedUserId] = { isBlocked: true, blockedByMe: true };
    } else if (block.blockedUserId === auth.userId) {
      blockMap[block.blockerUserId] = { isBlocked: true, blockedByMe: false };
    }
  }

  const items = await Promise.all(rows.map(async (conversation) => {
    const otherUserId = auth.role === 'customer' ? conversation.expert?.userId : conversation.customer?.userId;
    const blockState = blockMap[otherUserId] || { isBlocked: false, blockedByMe: false };

    const readState = conversation.readStates[0];
    const unreadCount = await db.message.count({
      where: {
        conversationId: conversation.id,
        senderUserId: { not: auth.userId },
        ...(readState ? { createdAt: { gt: readState.readAt } } : {})
      }
    });

    const lastMessage = conversation.messages[0] ?? null;
    return toConversationSummaryDto(conversation, {
      ...peerInfo(conversation, auth),
      unreadCount,
      lastMessage,
      isBlocked: blockState.isBlocked,
      blockedByMe: blockState.blockedByMe,
    });
  }));

  return paginatedResult(items, { page, limit, total });

}

export async function createConversation(auth, body) {
  const db = getDb();
  let customerId;
  let expertId;

  if (auth.role === "customer") {
    if (!body.expertId) {
      throw badRequest("expertIdRequired", "VALIDATION_ERROR", "expertId");
    }
    customerId = auth.customerProfileId;
    expertId = body.expertId;
  } else if (auth.role === "expert") {
    if (!body.customerId) {
      throw badRequest("customerIdRequired", "VALIDATION_ERROR", "customerId");
    }
    customerId = body.customerId;
    expertId = auth.expertProfileId;
  } else {
    throw forbidden("messagingRequiresRole");
  }

  const expert = await db.expertProfile.findUnique({ where: { id: expertId } });
  if (!expert) throw notFound("expertNotFound");

  const customer = await db.customerProfile.findUnique({ where: { id: customerId } });
  if (!customer) throw notFound("customerNotFound");

  if (expert.userId === customer.userId) {
    throw badRequest("cannotEngageWithSelf");
  }

  const conversation = await db.conversation.upsert({
    where: {
      customerId_expertId: { customerId, expertId },
    },
    create: { customerId, expertId },
    update: {},
    include: {
      customer: { include: { user: true, avatarMedia: true } },
      expert: { include: { avatarMedia: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  return toConversationSummaryDto(conversation, {
    ...peerInfo(conversation, auth),
    unreadCount: 0,
    lastMessage: conversation.messages[0] ?? null,
  });
}

function getCategoryFromMime(mimeType) {
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType?.startsWith("video/")) return "video";
  return "document";
}

function getExtFromKey(storageKey, mimeType) {
  if (storageKey && storageKey.includes(".")) {
    return "." + storageKey.split(".").pop();
  }
  const map = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "application/pdf": ".pdf",
    "video/mp4": ".mp4",
  };
  return map[mimeType] || "";
}

export async function listMessages(auth, conversationId, query) {
  await loadConversation(auth, conversationId);
  const { page, limit, skip } = parsePagination(query);
  const db = getDb();

  const [rows, total] = await Promise.all([
    db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        attachments: { include: { media: true } },
      },
    }),
    db.message.count({ where: { conversationId } }),
  ]);

  const items = await Promise.all(
    rows.map((message) => toMessageDto(message, message.attachments))
  );
  return paginatedResult(items, { page, limit, total });
}

export async function sendMessage(auth, conversationId, body) {
  if (!body.body && (!body.mediaIds || body.mediaIds.length === 0)) {
    throw badRequest("messageBodyRequired");
  }

  await loadConversation(auth, conversationId);
  
  // Check if either party has blocked the other
  const peerUserId = await getConversationPeerUserId(conversationId, auth.userId);
  if (peerUserId) {
    const db = getDb();
    const block = await db.userBlock.findFirst({
      where: {
        OR: [
          { blockerUserId: auth.userId, blockedUserId: peerUserId },
          { blockerUserId: peerUserId, blockedUserId: auth.userId },
        ],
      },
    });
    if (block) {
      throw forbidden("userBlockedCannotMessage");
    }
  }

  const db = getDb();
  const type = body.mediaIds?.length ? "attachment" : "text";

  if (body.mediaIds?.length) {
    const assets = await db.mediaAsset.findMany({
      where: {
        id: { in: body.mediaIds },
        ownerUserId: auth.userId,
        status: { not: "deleted" },
      },
    });

    if (assets.length !== body.mediaIds.length) {
      throw badRequest("mediaAssetsInvalid", "INVALID_MEDIA");
    }

    // Client decision (31 Aug 2026 call, §3.3): no image/video in standard chat.
    // Enforced again here, not just at upload — an asset uploaded under the
    // `quote_attachment` purpose bypasses the chat upload gate, so its id must not
    // be smuggled in as a chat attachment. Quote Requests remain the media workflow.
    if (!isChatMediaAllowed()) {
      const blocked = assets.find(
        (a) =>
          a.mimeType?.toLowerCase().startsWith("image/") ||
          a.mimeType?.toLowerCase().startsWith("video/")
      );
      if (blocked) {
        throw badRequest(getMessage("chatMediaNotAllowed"), "CHAT_MEDIA_NOT_ALLOWED");
      }
    }

    // Move any temporary staged media assets to permanent user/category/ path in S3
    for (const asset of assets) {
      if (asset.storageKey?.startsWith("temp/")) {
        const category = getCategoryFromMime(asset.mimeType);
        const ext = getExtFromKey(asset.storageKey, asset.mimeType);
        const permanentKey = `${auth.userId}/${category}/${asset.id}${ext}`;

        try {
          await moveS3Object(asset.storageKey, permanentKey);
          await db.mediaAsset.update({
            where: { id: asset.id },
            data: {
              storageKey: permanentKey,
              status: "ready",
            },
          });
          asset.storageKey = permanentKey;
          asset.status = "ready";
        } catch (err) {
          console.error(
            `[messagingService] Could not relocate S3 object (${asset.storageKey} -> ${permanentKey}):`,
            err.message
          );
        }
      }
    }
  }

  const message = await db.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        conversationId,
        senderUserId: auth.userId,
        body: body.body ?? null,
        type,
        deliveryStatus: "sent",
        ...(body.mediaIds?.length
          ? {
              attachments: {
                create: body.mediaIds.map((mediaId) => ({ mediaId })),
              },
            }
          : {}),
      },
      include: {
        attachments: { include: { media: true } },
      },
    });

    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: created.createdAt },
    });

    return created;
  });

  return await toMessageDto(message, message.attachments);
}

export async function markConversationRead(auth, conversationId) {
  await loadConversation(auth, conversationId);
  const db = getDb();

  const lastMessage = await db.message.findFirst({
    where: { conversationId },
    orderBy: { createdAt: "desc" },
  });

  if (!lastMessage) {
    return { read: true, unreadCount: 0 };
  }

  await db.conversationReadState.upsert({
    where: {
      conversationId_userId: {
        conversationId,
        userId: auth.userId,
      },
    },
    create: {
      conversationId,
      userId: auth.userId,
      lastReadMessageId: lastMessage.id,
      readAt: new Date(),
    },
    update: {
      lastReadMessageId: lastMessage.id,
      readAt: new Date(),
    },
  });

  return { read: true, unreadCount: 0 };
}

export async function blockUser(auth, targetUserId) {
  const db = getDb();
  let actualUserId = targetUserId;
  const targetUser = await db.user.findUnique({ where: { id: actualUserId } });
  if (!targetUser) {
    const expert = await db.expertProfile.findUnique({ where: { id: actualUserId } });
    if (expert) actualUserId = expert.userId;
    else {
      const customer = await db.customerProfile.findUnique({ where: { id: actualUserId } });
      if (customer) actualUserId = customer.userId;
    }
  }
  targetUserId = actualUserId;
  if (auth.userId === targetUserId) {
    throw badRequest("cannotBlockSelf");
  }
  await db.userBlock.upsert({
    where: {
      blockerUserId_blockedUserId: {
        blockerUserId: auth.userId,
        blockedUserId: targetUserId,
      },
    },
    create: { blockerUserId: auth.userId, blockedUserId: targetUserId },
    update: {},
  });
  return { blocked: true };
}

export async function unblockUser(auth, targetUserId) {
  const db = getDb();
  let actualUserId = targetUserId;
  const targetUser = await db.user.findUnique({ where: { id: actualUserId } });
  if (!targetUser) {
    const expert = await db.expertProfile.findUnique({ where: { id: actualUserId } });
    if (expert) actualUserId = expert.userId;
    else {
      const customer = await db.customerProfile.findUnique({ where: { id: actualUserId } });
      if (customer) actualUserId = customer.userId;
    }
  }
  targetUserId = actualUserId;
  await db.userBlock.deleteMany({
    where: { blockerUserId: auth.userId, blockedUserId: targetUserId },
  });
  return { blocked: false };
}

export async function reportConversation(auth, conversationId, reason) {
  await loadConversation(auth, conversationId);
  const db = getDb();
  const report = await db.conversationReport.create({
    data: {
      conversationId,
      reporterUserId: auth.userId,
      reason,
    },
  });
  return { id: report.id, reported: true };
}
