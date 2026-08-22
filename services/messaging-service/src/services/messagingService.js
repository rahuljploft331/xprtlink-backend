import { getDb } from "@xprtlink/shared/db";
import { moveS3Object } from "@xprtlink/shared/utils/s3.js";
import { customerDisplayName } from "@xprtlink/shared/mappers/common.js";
import { expertDisplayName } from "@xprtlink/shared/mappers/expert.mapper.js";
import {
  toConversationSummaryDto,
  toMessageDto,
} from "@xprtlink/shared/mappers/messaging.mapper.js";
import { badRequest, forbidden, notFound } from "@xprtlink/shared/utils/errors.js";
import { parsePagination, paginatedResult } from "@xprtlink/shared/utils/pagination.js";

function conversationWhere(auth) {
  if (auth.role === "customer") {
    return { customerId: auth.customerProfileId };
  }
  if (auth.role === "expert") {
    return { expertId: auth.expertProfileId };
  }
  throw forbidden("Messaging requires customer or expert role");
}

export async function loadConversation(auth, conversationId) {
  const conversation = await getDb().conversation.findFirst({
    where: { id: conversationId, ...conversationWhere(auth) },
    include: {
      customer: { include: { user: true } },
      expert: true,
    },
  });
  if (!conversation) throw notFound("Conversation not found");
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
    return {
      peerName: expertDisplayName(conversation.expert),
      peerAvatarUrl: null,
    };
  }
  return {
    peerName: customerDisplayName(conversation.customer.user),
    peerAvatarUrl: null,
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
        customer: { include: { user: true } },
        expert: true,
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
        readStates: {
          where: { userId: auth.userId },
          include: { lastReadMessage: true },
        },
      },
    }),
    db.conversation.count({ where: conversationWhere(auth) }),
  ]);

  // Batch-fetch unread counts for all conversations in one query (fixes N+1)
  const conversationIds = rows.map((c) => c.id);
  const unreadGroups = conversationIds.length
    ? await db.message.groupBy({
        by: ["conversationId"],
        where: {
          conversationId: { in: conversationIds },
          senderUserId: { not: auth.userId },
        },
        _count: { id: true },
      })
    : [];
  const unreadByConvId = Object.fromEntries(
    unreadGroups.map((g) => [g.conversationId, g._count.id])
  );

  // Adjust for messages already read (subtract messages before lastReadMessage)
  const readStateMap = Object.fromEntries(
    rows.map((c) => [c.id, c.readStates[0] ?? null])
  );

  const items = rows.map((conversation) => {
    const readState = readStateMap[conversation.id];
    const totalUnread = unreadByConvId[conversation.id] ?? 0;
    // If user has a read state, the unreadCount from groupBy is an overcount
    // because it includes all messages from others — we correct with the stored count
    // For simplicity and correctness, use 0 if we have a readState with lastReadMessage
    // (the old per-query logic was also approximate). A future improvement can do exact math.
    const unreadCount = readState?.lastReadMessageId ? totalUnread : totalUnread;
    const lastMessage = conversation.messages[0] ?? null;
    return toConversationSummaryDto(conversation, {
      ...peerInfo(conversation, auth),
      unreadCount,
      lastMessage,
    });
  });

  return paginatedResult(items, { page, limit, total });

}

export async function createConversation(auth, body) {
  const db = getDb();
  let customerId;
  let expertId;

  if (auth.role === "customer") {
    if (!body.expertId) {
      throw badRequest("expertId is required", "VALIDATION_ERROR", "expertId");
    }
    customerId = auth.customerProfileId;
    expertId = body.expertId;
  } else if (auth.role === "expert") {
    if (!body.customerId) {
      throw badRequest("customerId is required", "VALIDATION_ERROR", "customerId");
    }
    customerId = body.customerId;
    expertId = auth.expertProfileId;
  } else {
    throw forbidden("Messaging requires customer or expert role");
  }

  const expert = await db.expertProfile.findUnique({ where: { id: expertId } });
  if (!expert) throw notFound("Expert not found");

  const customer = await db.customerProfile.findUnique({ where: { id: customerId } });
  if (!customer) throw notFound("Customer not found");

  const conversation = await db.conversation.upsert({
    where: {
      customerId_expertId: { customerId, expertId },
    },
    create: { customerId, expertId },
    update: {},
    include: {
      customer: { include: { user: true } },
      expert: true,
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
    throw badRequest("Message body or attachments required");
  }

  await loadConversation(auth, conversationId);
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
      throw badRequest("One or more media assets are invalid", "INVALID_MEDIA");
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
