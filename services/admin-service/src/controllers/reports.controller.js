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

export async function exportReport(req, res, next) {
  try {
    const db = getDb();
    const { reportId } = req.params;
    let data = [];
    
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    switch (reportId) {
      case "registrations":
        const [customers, experts] = await Promise.all([
          db.customerProfile.findMany({
            where: { createdAt: { gte: thirtyDaysAgo } },
            include: { user: { select: { email: true, phone: true } } }
          }),
          db.expertProfile.findMany({
            where: { createdAt: { gte: thirtyDaysAgo } },
            include: { user: { select: { email: true, phone: true } } }
          })
        ]);
        data = [
          ...customers.map(c => ({ id: c.id, role: 'Customer', name: `${c.firstName} ${c.lastName}`, email: c.user?.email || '', createdAt: c.createdAt.toISOString() })),
          ...experts.map(e => ({ id: e.id, role: 'Expert', name: `${e.firstName} ${e.lastName}`, email: e.user?.email || '', createdAt: e.createdAt.toISOString() }))
        ];
        break;
      
      case "consultation-volume":
        const consultations = await db.consultation.findMany({
          where: { createdAt: { gte: thirtyDaysAgo }, status: "completed" },
          include: { 
            customer: { select: { firstName: true, lastName: true } }, 
            expert: { select: { firstName: true, lastName: true } } 
          }
        });
        data = consultations.map(c => ({
          id: c.id,
          customer: `${c.customer.firstName} ${c.customer.lastName}`,
          expert: `${c.expert.firstName} ${c.expert.lastName}`,
          duration: c.durationSeconds || 0,
          rateCents: c.ratePerMinuteCents,
          completedAt: c.endedAt?.toISOString() || c.updatedAt.toISOString()
        }));
        break;

      case "revenue-commissions":
        const transactions = await db.transaction.findMany({
          where: { createdAt: { gte: thirtyDaysAgo }, status: "succeeded" },
          include: { consultationCharge: true }
        });
        data = transactions.map(t => ({
          id: t.id,
          type: t.type,
          amountCents: t.amountCents,
          commissionCents: t.consultationCharge?.commissionCents || 0,
          expertShareCents: t.consultationCharge?.expertShareCents || 0,
          createdAt: t.createdAt.toISOString()
        }));
        break;

      case "expert-performance":
        const activeExperts = await db.expertProfile.findMany({
          where: {
            consultations: {
              some: { status: "completed", createdAt: { gte: thirtyDaysAgo } },
            },
          },
          include: { _count: { select: { consultations: true } } }
        });
        data = activeExperts.map(e => ({
          id: e.id,
          name: `${e.firstName} ${e.lastName}`,
          ratingAvg: Number(e.ratingAvg),
          ratingCount: e.ratingCount,
          totalConsultations: e._count.consultations,
          createdAt: e.createdAt.toISOString()
        }));
        break;
      
      default:
        data = [{ id: 1, message: "Report details not fully mapped, showing placeholder" }];
    }

    if (data.length === 0) {
      data = [{ id: "none", message: "No data available for the last 30 days" }];
    }

    const headers = Object.keys(data[0]).join(",");
    const rows = data.map(row => 
      Object.values(row)
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csvString = [headers, ...rows].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=report-${reportId}.csv`);
    res.send(csvString);
  } catch (err) {
    next(err);
  }
}
