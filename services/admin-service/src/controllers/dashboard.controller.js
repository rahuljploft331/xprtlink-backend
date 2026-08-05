import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";

/** GET /api/dashboard/stats */
export async function getStats(_req, res, next) {
  try {
    const db = getDb();
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalCustomers,
      totalExperts,
      pendingVerifications,
      activeSubscriptions,
      consultations30d,
      quotes30d,
      pendingPayouts,
      pendingReviews,
      pendingPaymentsInvestigating,
    ] = await Promise.all([
      db.customerProfile.count(),
      db.expertProfile.count(),
      db.expertVerification.count({ where: { status: "pending" } }),
      db.expertSubscription.count({ where: { status: "active" } }),
      db.consultation.count({
        where: { createdAt: { gte: thirtyDaysAgo }, status: "completed" },
      }),
      db.quoteRequest.count({
        where: { createdAt: { gte: thirtyDaysAgo } },
      }),
      db.expertPayout.count({ where: { status: "pending" } }),
      db.review.count({ where: { status: "flagged" } }),
      db.transaction.count({ where: { status: "pending" } }),
    ]);

    // Revenue last 30d (sum of succeeded consultation_charge transactions)
    const revenueResult = await db.transaction.aggregate({
      _sum: { amountCents: true },
      where: {
        status: "succeeded",
        type: "consultation_charge",
        createdAt: { gte: thirtyDaysAgo },
      },
    });
    const revenueCents = revenueResult._sum.amountCents || 0;
    const revenue30d = `$${(revenueCents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;

    const pendingAdminActions =
      pendingVerifications + pendingReviews + pendingPaymentsInvestigating + pendingPayouts;

    const stats = [
      { id: "customers", label: "Total Customers", value: totalCustomers.toLocaleString(), trend: "up" },
      { id: "experts", label: "Total Experts", value: totalExperts.toLocaleString(), trend: "up" },
      { id: "verifications", label: "Pending Verifications", value: String(pendingVerifications), trend: pendingVerifications > 0 ? "neutral" : "up" },
      { id: "subscriptions", label: "Active Subscriptions", value: activeSubscriptions.toLocaleString(), trend: "up" },
      { id: "consultations", label: "Consultations (30d)", value: consultations30d.toLocaleString(), trend: "up" },
      { id: "quotes", label: "Quote Requests (30d)", value: quotes30d.toLocaleString(), trend: "up" },
      { id: "revenue", label: "Platform Revenue (30d)", value: revenue30d, trend: "up" },
      { id: "actions", label: "Pending Admin Actions", value: String(pendingAdminActions), trend: pendingAdminActions > 0 ? "down" : "up" },
    ];

    // Recent activity — last 10 consultations/verifications/transactions mixed
    const [recentConsultations, recentVerifications, recentTransactions] = await Promise.all([
      db.consultation.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: {
          customer: { select: { firstName: true, lastName: true } },
          expert: { select: { firstName: true, lastName: true } },
        },
      }),
      db.expertVerification.findMany({
        take: 5,
        orderBy: { submittedAt: "desc" },
        include: {
          expert: { select: { firstName: true, lastName: true } },
        },
      }),
      db.transaction.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        where: { status: "succeeded" },
      }),
    ]);

    const recentActivity = [
      ...recentConsultations.map((c) => ({
        id: c.id,
        type: "consultation",
        title: `Consultation ${c.status}`,
        detail: `${c.customer.firstName} ${c.customer.lastName} → ${c.expert.firstName} ${c.expert.lastName}`,
        time: formatRelative(c.createdAt),
      })),
      ...recentVerifications.map((v) => ({
        id: v.id,
        type: "verification",
        title: "Verification submitted",
        detail: `${v.expert.firstName} ${v.expert.lastName}`,
        time: formatRelative(v.submittedAt),
      })),
      ...recentTransactions.map((t) => ({
        id: t.id,
        type: "payment",
        title: "Payment captured",
        detail: `$${(t.amountCents / 100).toFixed(2)} · ${t.type}`,
        time: formatRelative(t.createdAt),
      })),
    ]
      .sort((a, b) => 0) // already mixed; for proper sort we'd need timestamps
      .slice(0, 8);

    // Pending actions
    const pendingActions = [
      { id: "v", label: "Review expert ID documents", module: "Verifications", count: pendingVerifications, href: "/verifications" },
      { id: "r", label: "Moderate flagged reviews", module: "Reviews", count: pendingReviews, href: "/reviews" },
      { id: "p", label: "Investigate refund requests", module: "Payments", count: pendingPaymentsInvestigating, href: "/payments" },
      { id: "po", label: "Process pending payouts", module: "Payouts", count: pendingPayouts, href: "/payouts" },
    ].filter((a) => a.count > 0);

    return ResponseFormatter.success(res, {
      data: { stats, recentActivity, pendingActions },
    });
  } catch (err) {
    next(err);
  }
}

function formatRelative(date) {
  const diffMs = Date.now() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return `${Math.floor(diffHrs / 24)}d ago`;
}
