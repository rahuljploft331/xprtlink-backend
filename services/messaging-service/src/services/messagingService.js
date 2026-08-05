import { getDb } from "@xprtlink/shared/db";
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

async function loadConversation(auth, conversationId) {
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

  const items = await Promise.all(
    rows.map(async (conversation) => {
      const readState = conversation.readStates[0];
      const unreadCount = await countUnreadMessages(
        conversation.id,
        auth.userId,
        readState?.lastReadMessage
      );
      const lastMessage = conversation.messages[0] ?? null;
      return toConversationSummaryDto(conversation, {
        ...peerInfo(conversation, auth),
        unreadCount,
        lastMessage,
      });
    })
  );

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

  const items = rows.map((message) => toMessageDto(message, message.attachments));
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
    const ownedCount = await db.mediaAsset.count({
      where: {
        id: { in: body.mediaIds },
        ownerUserId: auth.userId,
        status: { not: "deleted" },
      },
    });
    if (ownedCount !== body.mediaIds.length) {
      throw badRequest("One or more media assets are invalid", "INVALID_MEDIA");
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

  return toMessageDto(message, message.attachments);
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
