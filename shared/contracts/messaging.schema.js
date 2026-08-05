import { z } from "zod";

export const conversationSummaryDtoSchema = z.object({
  id: z.string().uuid(),
  expertId: z.string().uuid(),
  customerId: z.string().uuid(),
  peerName: z.string(),
  peerAvatarUrl: z.string().url().nullable(),
  lastMessagePreview: z.string().nullable(),
  lastMessageAt: z.string().datetime().nullable(),
  unreadCount: z.number().int().nonnegative(),
});

export const messageDtoSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  senderUserId: z.string().uuid(),
  body: z.string().nullable(),
  type: z.enum(["text", "attachment"]),
  deliveryStatus: z.enum(["sent", "delivered", "read", "failed"]),
  attachments: z.array(
    z.object({
      mediaId: z.string().uuid(),
      url: z.string().url().nullable(),
      mimeType: z.string().nullable(),
    })
  ),
  createdAt: z.string().datetime(),
});

export const createConversationRequestSchema = z.object({
  expertId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
});

export const sendMessageRequestSchema = z.object({
  body: z.string().max(5000).optional(),
  mediaIds: z.array(z.string().uuid()).optional(),
});
