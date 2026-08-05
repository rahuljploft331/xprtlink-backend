/**
 * Domain enums — string values match mobile API contract (docs/API-Endpoints-Mobile.md).
 * Prisma enums in schema.prisma use the same values.
 */

export const USER_STATUS = {
  ACTIVE: "active",
  SUSPENDED: "suspended",
  DELETED: "deleted",
};

export const AVAILABILITY_STATUS = {
  ONLINE: "online",
  OFFLINE: "offline",
  BUSY: "busy",
};

export const VERIFICATION_STATUS = {
  UNVERIFIED: "unverified",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
  RESUBMIT_REQUIRED: "resubmit_required",
};

export const CMS_PAGE_STATUS = {
  DRAFT: "draft",
  PUBLISHED: "published",
};

export const VISIBILITY_BOOST = {
  LISTING: "listing",
  TOP_25: "top_25",
  TOP_5: "top_5",
};

export const QUOTE_STATUS = {
  DRAFT: "draft",
  SUBMITTED: "submitted",
  PENDING_EXPERT_REVIEW: "pending_expert_review",
  QUOTED: "quoted",
  ACCEPTED: "accepted",
  REJECTED: "rejected",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
};

export const CONSULTATION_STATUS = {
  REQUESTED: "requested",
  RINGING: "ringing",
  ACCEPTED: "accepted",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  DECLINED: "declined",
  CANCELLED: "cancelled",
  FAILED: "failed",
};

export const CONSULTATION_BILLING_STATUS = {
  PENDING: "pending",
  CHARGED: "charged",
  FAILED: "failed",
  REFUNDED: "refunded",
};

export const REVIEW_STATUS = {
  PUBLISHED: "published",
  HIDDEN: "hidden",
  FLAGGED: "flagged",
};

export const EXPERT_REPORT_STATUS = {
  OPEN: "open",
  REVIEWING: "reviewing",
  RESOLVED: "resolved",
  DISMISSED: "dismissed",
};

export const MESSAGE_TYPE = {
  TEXT: "text",
  ATTACHMENT: "attachment",
};

export const MESSAGE_DELIVERY_STATUS = {
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
  FAILED: "failed",
};

export const MEDIA_PURPOSE = {
  AVATAR: "avatar",
  QUOTE_ATTACHMENT: "quote_attachment",
  CHAT_ATTACHMENT: "chat_attachment",
  VERIFICATION_DOC: "verification_doc",
};

export const MEDIA_STATUS = {
  PENDING_UPLOAD: "pending_upload",
  READY: "ready",
  DELETED: "deleted",
};

export const TRANSACTION_TYPE = {
  CONSULTATION_CHARGE: "consultation_charge",
  SUBSCRIPTION: "subscription",
  REFUND: "refund",
};

export const TRANSACTION_STATUS = {
  PENDING: "pending",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
  REFUNDED: "refunded",
};

export const SUBSCRIPTION_STORE = {
  APPLE: "apple",
  GOOGLE: "google",
};

export const EXPERT_SUBSCRIPTION_STATUS = {
  ACTIVE: "active",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
  GRACE_PERIOD: "grace_period",
};

export const PAYOUT_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  PAID: "paid",
  FAILED: "failed",
};

export const OTP_PURPOSE = {
  REGISTER: "register",
  RESET_PASSWORD: "reset_password",
  VERIFY_EMAIL: "verify_email",
  VERIFY_PHONE: "verify_phone",
};

export const DEVICE_PLATFORM = {
  IOS: "ios",
  ANDROID: "android",
  WEB: "web",
};
