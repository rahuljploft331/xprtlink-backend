import { getDb } from "@xprtlink/shared/db/getClient.js";
import { notFound, forbidden, badRequest } from "@xprtlink/shared/utils/errors.js";
import { parsePagination, paginatedResult } from "@xprtlink/shared/utils/pagination.js";

/**
 * Get or create the single open support conversation thread for a given user.
 */
export async function getOrCreateSupportConversation(userId) {
  const db = getDb();
  let conversation = await db.supportConversation.findFirst({
    where: { userId, status: { not: "closed" } },
    orderBy: { createdAt: "desc" },
    include: {
      user: { include: { customerProfile: true, expertProfile: true } },
      admin: { select: { name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    }
  });

  if (!conversation) {
    conversation = await db.supportConversation.create({
      data: { userId },
      include: {
        user: { include: { customerProfile: true, expertProfile: true } },
        admin: { select: { name: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      }
    });
  }

  return toSupportConversationDto(conversation);
}

/**
 * Force create a brand new support conversation thread for a given user.
 */
export async function createNewSupportConversation(userId) {
  const db = getDb();
  const conversation = await db.supportConversation.create({
    data: { userId },
    include: {
      user: { include: { customerProfile: true, expertProfile: true } },
      admin: { select: { name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    }
  });
  return toSupportConversationDto(conversation);
}

/**
 * Get a specific support conversation by ID. Checks access rules.
 */
export async function getSupportConversation(id, callerAuth) {
  const db = getDb();
  const conversation = await db.supportConversation.findUnique({
    where: { id },
    include: {
      user: { include: { customerProfile: true, expertProfile: true } },
      admin: { select: { name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    }
  });

  if (!conversation) throw notFound("Support conversation not found");

  if (["customer", "expert"].includes(callerAuth.role) && conversation.userId !== callerAuth.userId) {
    throw forbidden("You do not have access to this conversation");
  }

  return toSupportConversationDto(conversation);
}

/**
 * List paginated support conversations (Admin only).
 */
export async function listSupportConversations(callerAuth, query) {
  if (!["super_admin", "subadmin"].includes(callerAuth.role)) {
    throw forbidden("Admin access required to list support conversations");
  }
  
  const db = getDb();
  const { page, limit, skip } = parsePagination(query);
  
  // Open, assigned to ME, or resolved
  const where = {
    OR: [
      { status: "open" },
      { status: "assigned", adminUserId: callerAuth.userId },
      { status: "resolved" }
    ]
  };

  const [rows, total] = await Promise.all([
    db.supportConversation.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
      include: {
        user: { include: { customerProfile: true, expertProfile: true } },
        admin: { select: { name: true } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    }),
    db.supportConversation.count({ where }),
  ]);

  const items = rows.map(toSupportConversationDto);
  return paginatedResult(items, { page, limit, total });
}

/**
 * Fetch paginated messages for a support conversation.
 */
export async function listSupportMessages(conversationId, query, callerAuth) {
  await getSupportConversation(conversationId, callerAuth); // checks access
  
  const db = getDb();
  const { page, limit, skip } = parsePagination(query);

  const [rows, total] = await Promise.all([
    db.supportMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        senderUser: { select: { id: true } },
        senderAdmin: { select: { id: true, name: true } },
      },
    }),
    db.supportMessage.count({ where: { conversationId } }),
  ]);

  const items = rows.map(toSupportMessageDto);
  return paginatedResult(items, { page, limit, total });
}

/**
 * Send a message to a support conversation.
 */
export async function sendSupportMessage(conversationId, payload, callerAuth) {
  const conversation = await getSupportConversation(conversationId, callerAuth);
  if (conversation.status === "closed") {
    throw badRequest("Cannot send messages to a closed conversation");
  }
  if (!payload.body?.trim()) {
    throw badRequest("Message body is required");
  }

  const db = getDb();
  let data = {
    conversationId,
    body: payload.body.trim(),
    type: "text", // Add attachments later if needed
  };

  if (["super_admin", "subadmin"].includes(callerAuth.role)) {
    data.senderAdminId = callerAuth.userId;
    // Auto-assign to admin if it's currently open
    if (conversation.status === "open") {
      await db.supportConversation.update({
        where: { id: conversationId },
        data: { status: "assigned", adminUserId: callerAuth.userId, updatedAt: new Date() },
      });
    }
  } else {
    data.senderUserId = callerAuth.userId;
  }

  const message = await db.$transaction(async (tx) => {
    const created = await tx.supportMessage.create({
      data,
      include: {
        senderUser: { select: { id: true } },
        senderAdmin: { select: { id: true, name: true } },
      },
    });

    const updateData = { lastMessageAt: created.createdAt, updatedAt: created.createdAt };
    // If a user replies to a resolved ticket, reopen it
    if (conversation.status === "resolved" && data.senderUserId) {
      updateData.status = "open";
      updateData.adminUserId = null; // Unassign it so it goes back to the general queue
    }

    await tx.supportConversation.update({
      where: { id: conversationId },
      data: updateData,
    });

    return created;
  });

  return toSupportMessageDto(message);
}

/**
 * Mark a conversation as assigned to the current admin.
 */
export async function assignSupportConversation(conversationId, callerAuth) {
  if (!["super_admin", "subadmin"].includes(callerAuth.role)) {
    throw forbidden("Admin access required");
  }
  const db = getDb();
  await db.supportConversation.update({
    where: { id: conversationId },
    data: { status: "assigned", adminUserId: callerAuth.userId, updatedAt: new Date() },
  });
}

/**
 * Release a conversation lock back to open.
 */
export async function unassignSupportConversation(conversationId, callerAuth) {
  if (!["super_admin", "subadmin"].includes(callerAuth.role)) {
    throw forbidden("Admin access required");
  }
  const db = getDb();
  await db.supportConversation.update({
    where: { id: conversationId, adminUserId: callerAuth.userId },
    data: { status: "open", adminUserId: null, updatedAt: new Date() },
  });
}

/**
 * Automatically release all locks held by a disconnecting admin.
 */
export async function releaseAdminConversations(adminUserId) {
  const db = getDb();
  await db.supportConversation.updateMany({
    where: { status: "assigned", adminUserId },
    data: { status: "open", adminUserId: null, updatedAt: new Date() },
  });
}

/**
 * Resolve a support conversation.
 */
export async function resolveSupportConversation(conversationId, callerAuth) {
  if (!["super_admin", "subadmin"].includes(callerAuth.role)) {
    throw forbidden("Admin access required");
  }
  const db = getDb();
  await db.supportConversation.update({
    where: { id: conversationId },
    data: { status: "resolved", updatedAt: new Date() },
  });
}

// ── DTO mappers ──────────────────────────────────────────────────────────────

function toSupportConversationDto(conv) {
  let userName = "Unknown User";
  let userAvatar = null;
  let userRole = "unknown";
  
  if (conv.user) {
    if (conv.user.customerProfile) {
      userName = `${conv.user.customerProfile.firstName} ${conv.user.customerProfile.lastName}`.trim();
      userAvatar = conv.user.customerProfile.avatarMediaId;
      userRole = "customer";
    } else if (conv.user.expertProfile) {
      userName = `${conv.user.expertProfile.firstName} ${conv.user.expertProfile.lastName}`.trim();
      userAvatar = conv.user.expertProfile.avatarMediaId;
      userRole = "expert";
    }
  }

  return {
    id: conv.id,
    userId: conv.userId,
    adminUserId: conv.adminUserId,
    status: conv.status,
    createdAt: conv.createdAt.toISOString(),
    updatedAt: conv.updatedAt.toISOString(),
    lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
    
    // Extracted peer details
    userName,
    userAvatar,
    userRole,
    adminName: conv.admin?.name ?? null,
    
    lastMessage: conv.messages?.[0] ? toSupportMessageDto(conv.messages[0]) : null,
  };
}

function toSupportMessageDto(msg) {
  return {
    id: msg.id,
    conversationId: msg.conversationId,
    senderUserId: msg.senderUserId,
    senderAdminId: msg.senderAdminId,
    senderName: msg.senderAdmin?.name ?? null, // Will only be populated for admin sender
    body: msg.body,
    type: msg.type,
    createdAt: msg.createdAt.toISOString(),
  };
}
