import { getDb } from "@xprtlink/shared/db";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { notFound, badRequest } from "@xprtlink/shared/utils/errors.js";
import { getMessage } from "@xprtlink/shared/utils/messages.js";

export const listExpertReports = async (req, res) => {
  const db = getDb();
  const reports = await db.expertReport.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { id: true, firstName: true, lastName: true } },
      expert: { select: { id: true, firstName: true, lastName: true } }
    }
  });
  return ResponseFormatter.success(res, { data: reports });
};

export const updateExpertReport = async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { status } = req.body;
  if (!status) throw badRequest("missingRequiredFields");

  const report = await db.expertReport.update({
    where: { id },
    data: { status }
  }).catch(() => null);

  if (!report) throw notFound("resourceNotFound");

  return ResponseFormatter.success(res, { data: report, message: getMessage("updatedSuccessfully") });
};

export const listConversationReports = async (req, res) => {
  const db = getDb();
  const reports = await db.conversationReport.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      reporter: {
        select: {
          id: true,
          email: true,
          customerProfile: { select: { id: true, firstName: true, lastName: true } },
          expertProfile: { select: { id: true, firstName: true, lastName: true } },
        }
      },
      conversation: { 
        select: { 
          id: true, 
          customerId: true, 
          expertId: true,
          customer: { select: { userId: true, firstName: true, lastName: true, user: { select: { email: true } } } },
          expert: { select: { userId: true, firstName: true, lastName: true, user: { select: { email: true } } } }
        } 
      }
    }
  });

  const formattedReports = reports.map((r) => {
    let reportedUser = null;
    if (r.reporter) {
      if (r.reporter.expertProfile && r.conversation.customer) {
        reportedUser = {
          userId: r.conversation.customer.userId,
          profileId: r.conversation.customerId,
          email: r.conversation.customer.user?.email || "Unknown",
          name: `${r.conversation.customer.firstName} ${r.conversation.customer.lastName}`,
          role: "customer"
        };
      } else if (r.reporter.customerProfile && r.conversation.expert) {
        reportedUser = {
          userId: r.conversation.expert.userId,
          profileId: r.conversation.expertId,
          email: r.conversation.expert.user?.email || "Unknown",
          name: `${r.conversation.expert.firstName} ${r.conversation.expert.lastName}`,
          role: "expert"
        };
      }
    }

    return {
      ...r,
      reporter: r.reporter ? {
        id: r.reporter.id,
        email: r.reporter.email,
        role: r.reporter.expertProfile ? "expert" : r.reporter.customerProfile ? "customer" : "unknown",
      } : null,
      reportedUser
    };
  });

  return ResponseFormatter.success(res, { data: formattedReports });
};

export const deleteConversationReport = async (req, res) => {
  const db = getDb();
  const { id } = req.params;
  
  const report = await db.conversationReport.delete({
    where: { id }
  }).catch(() => null);

  if (!report) throw notFound("resourceNotFound");

  return ResponseFormatter.success(res, { message: getMessage("deletedSuccessfully") });
};
