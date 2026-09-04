import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";

/** GET /api/v1/admin/reports/summary */
export async function getSummary(_req, res, next) {
  try {
    const db = getDb();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      newCustomers,
      newExperts,
      completedConsultations,
      succeededTransactions,
      activeExperts,
    ] = await Promise.all([
      // Registrations: new customer profiles in last 30 days
      db.customerProfile.count({
        where: { createdAt: { gte: thirtyDaysAgo } },
      }),
      // Registrations: new expert profiles in last 30 days
      db.expertProfile.count({
        where: { createdAt: { gte: thirtyDaysAgo } },
      }),
      // Consultation volume: completed consultations in last 30 days
      db.consultation.count({
        where: { createdAt: { gte: thirtyDaysAgo }, status: "completed" },
      }),
      // Revenue & commissions: succeeded transactions in last 30 days
      db.transaction.count({
        where: { createdAt: { gte: thirtyDaysAgo }, status: "succeeded" },
      }),
      // Expert performance: experts with at least one completed consultation in last 30 days
      db.expertProfile.count({
        where: {
          consultations: {
            some: { status: "completed", createdAt: { gte: thirtyDaysAgo } },
          },
        },
      }),
    ]);

    const reports = [
      {
        id: "registrations",
        name: "Registrations",
        description: "New customer and expert signups",
        range: "Last 30 days",
        recordCount: newCustomers + newExperts,
        lastGenerated: now.toISOString(),
      },
      {
        id: "consultation-volume",
        name: "Consultation Volume",
        description: "Completed consultations and revenue",
        range: "Last 30 days",
        recordCount: completedConsultations,
        lastGenerated: now.toISOString(),
      },
      {
        id: "revenue-commissions",
        name: "Revenue & Commissions",
        description: "Platform fees and expert payouts",
        range: "Last 30 days",
        recordCount: succeededTransactions,
        lastGenerated: now.toISOString(),
      },
      {
        id: "expert-performance",
        name: "Expert Performance",
        description: "Ratings, response times, completion rates",
        range: "Last 30 days",
        recordCount: activeExperts,
        lastGenerated: now.toISOString(),
      },
    ];

    return ResponseFormatter.success(res, { data: { reports } });
  } catch (err) {
    next(err);
  }
}

export async function exportReport(req, res) {
  // Return a dummy CSV or empty response for the export
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=report-${req.params.reportId}.csv`);
  res.send("id,name\n1,Stubbed Report");
}
