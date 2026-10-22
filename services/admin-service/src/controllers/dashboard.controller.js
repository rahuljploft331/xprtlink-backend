import { getDb } from "@xprtlink/shared/db/getClient.js";
import { ResponseFormatter } from "@xprtlink/shared/utils/responseFormatter.js";
import { parsePagination } from "@xprtlink/shared/utils/pagination.js";

/** A lost chargeback means the platform kept none of that charge. */
const NOT_LOST_DISPUTE = { OR: [{ disputeStatus: null }, { disputeStatus: { not: "lost" } }] };

/** Commission + subscription revenue rows (amountCents, createdAt) in a date range. */
async function platformRevenueEntries(db, createdAt) {
  const [commissions, subscriptions] = await Promise.all([
    db.consultationCharge.findMany({
      where: { createdAt, consultation: { billingStatus: "charged" }, ...NOT_LOST_DISPUTE },
      select: { commissionCents: true, createdAt: true },
    }),
    db.transaction.findMany({
      where: { status: "succeeded", type: "subscription", createdAt },
      select: { amountCents: true, createdAt: true },
    }),
  ]);
  return [
    ...commissions.map((c) => ({ amountCents: c.commissionCents, createdAt: c.createdAt })),
    ...subscriptions,
  ];
}

async function platformRevenueCents(db, createdAt) {
  const [commission, subscriptions] = await Promise.all([
    db.consultationCharge.aggregate({
      _sum: { commissionCents: true },
      where: { createdAt, consultation: { billingStatus: "charged" }, ...NOT_LOST_DISPUTE },
    }),
    db.transaction.aggregate({
      _sum: { amountCents: true },
      where: { status: "succeeded", type: "subscription", createdAt },
    }),
  ]);
  return (commission._sum.commissionCents || 0) + (subscriptions._sum.amountCents || 0);
}

/** 30 UTC calendar day window: today UTC + past 29 days (30 days total). */
function getThirtyDayRange(now = new Date()) {
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const thirtyDaysAgo = new Date(todayUtc.getTime() - 29 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(todayUtc.getTime() - 59 * 24 * 60 * 60 * 1000);
  return { now, todayUtc, thirtyDaysAgo, sixtyDaysAgo };
}

/** GET /api/dashboard/stats */
export async function getStats(_req, res, next) {
  try {
    const db = getDb();
    const { thirtyDaysAgo, sixtyDaysAgo } = getThirtyDayRange();

    const [
      totalCustomers,
      totalExperts,
      totalConsultations,
      totalQuotes,
      pendingVerifications,
      activeSubscriptions,
      consultations30d,
      consultationsPrev30d,
      quotes30d,
      quotesPrev30d,
      customers30d,
      customersPrev30d,
      experts30d,
      expertsPrev30d,
      pendingPayouts,
      pendingReviews,
      pendingPaymentsInvestigating,
      subs30d,
      subsPrev30d,
      pendingSupportTickets,
      pendingPlatformIssues,
    ] = await Promise.all([
      db.customerProfile.count(),
      db.expertProfile.count(),
      db.consultation.count(),
      db.quoteRequest.count(),
      db.expertVerification.count({ where: { status: { in: ["pending", "in_progress"] } } }),
      db.expertSubscription.count({ where: { status: "active" } }),
      db.consultation.count({
        where: { createdAt: { gte: thirtyDaysAgo } },
      }),
      db.consultation.count({
        where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      }),
      db.quoteRequest.count({
        where: { createdAt: { gte: thirtyDaysAgo } },
      }),
      db.quoteRequest.count({
        where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      }),
      db.customerProfile.count({
        where: { createdAt: { gte: thirtyDaysAgo } },
      }),
      db.customerProfile.count({
        where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      }),
      db.expertProfile.count({
        where: { createdAt: { gte: thirtyDaysAgo } },
      }),
      db.expertProfile.count({
        where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } },
      }),
      db.expertPayout.count({ where: { status: "pending" } }),
      db.review.count({ where: { status: "flagged" } }),
      db.transaction.count({ where: { status: "pending" } }),
      db.expertSubscription.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      db.expertSubscription.count({ where: { createdAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo } } }),
      db.supportTicket.count({ where: { status: { in: ["open", "in_progress"] } } }),
      db.platformIssue.count({ where: { status: { in: ["open", "in_progress"] } } }),
    ]);

    // Platform Revenue = what the platform keeps: consultation commission (on
    // calls that were not refunded) + expert subscriptions. Not GMV — the
    // expert's share of a consultation charge is owed to the expert.
    const [revenueCents, revenuePrevCents] = await Promise.all([
      platformRevenueCents(db, { gte: thirtyDaysAgo }),
      platformRevenueCents(db, { gte: sixtyDaysAgo, lt: thirtyDaysAgo }),
    ]);
    const revenue30d = `$${(revenueCents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;

    // Card disputes to answer + money events flagged by billing webhooks.
    const paymentsNeedingAttention = await db.consultationCharge.count({
      where: { OR: [{ disputeStatus: "open" }, { needsReview: true }] },
    });

    const pendingAdminActions =
      pendingVerifications +
      pendingReviews +
      pendingPaymentsInvestigating +
      pendingPayouts +
      paymentsNeedingAttention +
      pendingSupportTickets +
      pendingPlatformIssues;

    const custDelta = calculateDelta(customers30d, customersPrev30d);
    const expDelta = calculateDelta(experts30d, expertsPrev30d);
    const consDelta = calculateDelta(consultations30d, consultationsPrev30d);
    const quotesDelta = calculateDelta(quotes30d, quotesPrev30d);
    const revDelta = calculateDelta(revenueCents, revenuePrevCents);
    const subsDelta = calculateDelta(subs30d, subsPrev30d);

    const stats = [
      { id: "customers", label: "Total Customers", value: totalCustomers.toLocaleString(), delta: custDelta.delta, trend: custDelta.trend },
      { id: "experts", label: "Total Experts", value: totalExperts.toLocaleString(), delta: expDelta.delta, trend: expDelta.trend },
      { id: "verifications", label: "Pending Verifications", value: String(pendingVerifications), delta: pendingVerifications > 0 ? `${pendingVerifications} pending` : "All clear", trend: pendingVerifications > 0 ? "neutral" : "up" },
      { id: "subscriptions", label: "Active Subscriptions", value: activeSubscriptions.toLocaleString(), delta: subsDelta.delta, trend: subsDelta.trend },
      { id: "consultations", label: "Total Consultations", value: totalConsultations.toLocaleString(), delta: consDelta.delta, trend: consDelta.trend },
      { id: "quotes", label: "Total Quote Requests", value: totalQuotes.toLocaleString(), delta: quotesDelta.delta, trend: quotesDelta.trend },
      { id: "revenue", label: "Platform Revenue (30d)", value: revenue30d, delta: revDelta.delta, trend: revDelta.trend },
      { id: "actions", label: "Pending Admin Actions", value: String(pendingAdminActions), delta: pendingAdminActions > 0 ? `${pendingAdminActions} queue` : "All clear", trend: pendingAdminActions > 0 ? "down" : "up" },
    ];

    // Recent activity — consultations/verifications/transactions/tickets
    const [recentConsultations, recentVerifications, recentTransactions, recentTickets] = await Promise.all([
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
        include: {
          consultationCharge: {
            include: {
              consultation: {
                select: {
                  id: true,
                  customer: { select: { firstName: true, lastName: true } },
                  expert: { select: { firstName: true, lastName: true } },
                },
              },
            },
          },
        },
      }),
      db.supportTicket.findMany({
        take: 5,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: {
              email: true,
              customerProfile: { select: { firstName: true, lastName: true } },
              expertProfile: { select: { firstName: true, lastName: true } },
            },
          },
        },
      }),
    ]);

    const recentActivity = [
      ...recentConsultations.map(formatConsultationActivity),
      ...recentVerifications.map(formatVerificationActivity),
      ...recentTransactions.map(formatTransactionActivity),
      ...recentTickets.map(formatTicketActivity),
    ]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 8);

    // Pending actions
    const pendingActions = [
      { id: "t", label: "Review open support tickets", module: "Support Tickets", count: pendingSupportTickets, href: "/support-tickets?status=open" },
      { id: "pi", label: "Resolve reported platform issues", module: "Platform Issues", count: pendingPlatformIssues, href: "/platform-issues?status=open" },
      { id: "v", label: "Review expert ID documents", module: "Verifications", count: pendingVerifications, href: "/verifications?status=pending" },
      { id: "d", label: "Resolve card disputes & payment reviews", module: "Payments", count: paymentsNeedingAttention, href: "/payments" },
      { id: "r", label: "Moderate flagged reviews", module: "Reviews", count: pendingReviews, href: "/reviews?status=flagged" },
      { id: "p", label: "Investigate refund requests", module: "Payments", count: pendingPaymentsInvestigating, href: "/payments?status=pending" },
      { id: "po", label: "Process pending payouts", module: "Payouts", count: pendingPayouts, href: "/payouts?status=pending" },
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

function formatConsultationActivity(c) {
  const customerName = [c.customer?.firstName, c.customer?.lastName].filter(Boolean).join(" ").trim() || "Customer";
  const expertName = [c.expert?.firstName, c.expert?.lastName].filter(Boolean).join(" ").trim() || "Expert";

  let title = "Consultation update";
  let detail = `Consultation between ${customerName} and ${expertName}`;

  switch (c.status) {
    case "completed":
      title = "Consultation completed";
      detail = `${customerName} completed consultation with ${expertName}`;
      break;
    case "failed":
      title = "Consultation failed";
      detail = `Consultation between ${customerName} and ${expertName} failed`;
      break;
    case "in_progress":
      title = "Consultation in progress";
      detail = `${customerName} and ${expertName} started consultation`;
      break;
    case "accepted":
      title = "Consultation accepted";
      detail = `${expertName} accepted consultation request from ${customerName}`;
      break;
    case "declined":
      title = "Consultation declined";
      detail = `${expertName} declined consultation request from ${customerName}`;
      break;
    case "canceled":
      title = "Consultation canceled";
      detail = `Consultation between ${customerName} and ${expertName} was canceled`;
      break;
    case "requested":
      title = "Consultation requested";
      detail = `${customerName} requested a consultation with ${expertName}`;
      break;
    case "ringing":
      title = "Consultation ringing";
      detail = `${customerName} is calling ${expertName}`;
      break;
    default:
      title = `Consultation ${c.status ? c.status.replace(/_/g, " ") : "update"}`;
      detail = `Consultation between ${customerName} and ${expertName}`;
      break;
  }

  return {
    id: c.id,
    type: "consultation",
    title,
    detail,
    href: `/consultations/${c.id}`,
    time: formatRelative(c.createdAt),
    timestamp: new Date(c.createdAt).getTime(),
  };
}

function formatVerificationActivity(v) {
  const expertName = [v.expert?.firstName, v.expert?.lastName].filter(Boolean).join(" ").trim() || "Expert";
  let title = "Verification submitted";
  let detail = `${expertName} submitted identity verification documents`;

  if (v.status === "approved") {
    title = "Verification approved";
    detail = `${expertName}'s verification documents were approved`;
  } else if (v.status === "rejected") {
    title = "Verification rejected";
    detail = `${expertName}'s verification documents were rejected`;
  } else if (v.status === "resubmit_required") {
    title = "Resubmission requested";
    detail = `Document resubmission requested for ${expertName}`;
  } else if (v.status === "in_progress") {
    title = "Verification under review";
    detail = `${expertName}'s verification documents are under review`;
  }

  return {
    id: v.id,
    type: "verification",
    title,
    detail,
    href: `/verifications/${v.id}`,
    time: formatRelative(v.submittedAt || v.createdAt),
    timestamp: new Date(v.submittedAt || v.createdAt).getTime(),
  };
}

function formatTransactionActivity(t) {
  const amount = `$${(t.amountCents / 100).toFixed(2)}`;
  const cons = t.consultationCharge?.consultation;
  const customerName = cons?.customer
    ? [cons.customer.firstName, cons.customer.lastName].filter(Boolean).join(" ").trim()
    : null;
  const expertName = cons?.expert
    ? [cons.expert.firstName, cons.expert.lastName].filter(Boolean).join(" ").trim()
    : null;

  let title = "Payment captured";
  let detail = "";

  if (t.type === "consultation_charge") {
    title = "Payment captured";
    if (customerName && expertName) {
      detail = `${customerName} paid ${amount} for consultation with ${expertName}`;
    } else if (customerName) {
      detail = `${customerName} paid ${amount} for consultation`;
    } else if (expertName) {
      detail = `${amount} captured for consultation with ${expertName}`;
    } else {
      detail = `${amount} consultation charge captured`;
    }
  } else if (t.type === "refund") {
    title = "Payment refunded";
    if (customerName && expertName) {
      detail = `${amount} refunded to ${customerName} for consultation with ${expertName}`;
    } else if (customerName) {
      detail = `${amount} refunded to ${customerName}`;
    } else {
      detail = `${amount} refund processed`;
    }
  } else if (t.type === "subscription") {
    title = "Subscription payment";
    if (expertName) {
      detail = `${expertName} paid ${amount} for subscription`;
    } else {
      detail = `${amount} subscription payment captured`;
    }
  } else {
    title = "Payment captured";
    if (customerName && expertName) {
      detail = `${customerName} paid ${amount} to ${expertName}`;
    } else if (customerName) {
      detail = `${customerName} paid ${amount}`;
    } else {
      detail = `${amount} · ${t.type.replace(/_/g, " ")}`;
    }
  }

  return {
    id: t.id,
    type: "payment",
    title,
    detail,
    href: `/payments/${t.id}`,
    time: formatRelative(t.createdAt),
    timestamp: new Date(t.createdAt).getTime(),
  };
}

function formatTicketActivity(t) {
  const name =
    t.user?.customerProfile?.firstName
      ? `${t.user.customerProfile.firstName} ${t.user.customerProfile.lastName}`.trim()
      : t.user?.expertProfile?.firstName
      ? `${t.user.expertProfile.firstName} ${t.user.expertProfile.lastName}`.trim()
      : t.user?.email || "User";

  const subject = t.subject || t.category || "General inquiry";
  let title = `Support ticket (${t.status.replace(/_/g, " ")})`;
  let detail = `${name} opened ticket: "${subject}"`;

  if (t.status === "resolved") {
    title = "Support ticket resolved";
    detail = `${name}'s ticket "${subject}" was marked resolved`;
  } else if (t.status === "closed") {
    title = "Support ticket closed";
    detail = `${name}'s ticket "${subject}" was closed`;
  } else if (t.status === "in_progress") {
    title = "Support ticket in progress";
    detail = `${name}'s ticket "${subject}" is under review`;
  }

  return {
    id: t.id,
    type: "ticket",
    title,
    detail,
    href: `/support-tickets/${t.id}`,
    time: formatRelative(t.createdAt),
    timestamp: new Date(t.createdAt).getTime(),
  };
}

function calculateDelta(current, previous) {
  if (previous === 0) {
    if (current === 0) return { delta: "0%", trend: "neutral" };
    return { delta: "+100%", trend: "up" };
  }
  const diff = current - previous;
  const pct = Math.round((diff / previous) * 100);
  if (pct > 0) return { delta: `+${pct}%`, trend: "up" };
  if (pct < 0) return { delta: `${pct}%`, trend: "down" };
  return { delta: "0%", trend: "neutral" };
}

export async function getTrends(req, res, next) {
  try {
    const db = getDb();
    const { todayUtc, thirtyDaysAgo } = getThirtyDayRange();

    const [transactions, customers, experts, consultations] = await Promise.all([
      platformRevenueEntries(db, { gte: thirtyDaysAgo }),
      db.customerProfile.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true },
      }),
      db.expertProfile.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true },
      }),
      db.consultation.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true },
      }),
    ]);

    // Grouping by date (YYYY-MM-DD)
    const revenueByDate = {};
    const usersByDate = {};
    const consultationsByDate = {};

    // Initialize all 30 days
    for (let i = 29; i >= 0; i--) {
      const d = new Date(todayUtc.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().split("T")[0];
      revenueByDate[dateStr] = 0;
      usersByDate[dateStr] = 0;
      consultationsByDate[dateStr] = 0;
    }

    transactions.forEach(t => {
      const d = t.createdAt.toISOString().split("T")[0];
      if (revenueByDate[d] !== undefined) revenueByDate[d] += t.amountCents;
    });

    [...customers, ...experts].forEach(u => {
      const d = u.createdAt.toISOString().split("T")[0];
      if (usersByDate[d] !== undefined) usersByDate[d] += 1;
    });

    consultations.forEach(c => {
      const d = c.createdAt.toISOString().split("T")[0];
      if (consultationsByDate[d] !== undefined) consultationsByDate[d] += 1;
    });

    const revenue = Object.entries(revenueByDate).map(([date, value]) => ({ date, value: value / 100 }));
    const users = Object.entries(usersByDate).map(([date, value]) => ({ date, value }));
    const consultationsData = Object.entries(consultationsByDate).map(([date, value]) => ({ date, value }));

    return ResponseFormatter.success(res, {
      data: {
        revenue,
        users,
        consultations: consultationsData,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getLowRatingAlerts(req, res, next) {
  try {
    const db = getDb();
    const { page, limit, skip } = parsePagination(req.query);

    const [total, items] = await Promise.all([
      db.review.count({ where: { rating: { lte: 3 } } }),
      db.review.findMany({
        where: { rating: { lte: 3 } },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          customer: { select: { firstName: true, lastName: true } },
          expert: { select: { firstName: true, lastName: true } },
        },
      }),
    ]);

    const formattedItems = items.map(r => ({
      id: r.id,
      consultationId: r.consultationId,
      expertId: r.expertId,
      rating: r.rating,
      comment: r.comment,
      status: r.status,
      customerName: `${r.customer.firstName} ${r.customer.lastName}`,
      expertName: `${r.expert.firstName} ${r.expert.lastName}`,
      createdAt: r.createdAt,
    }));

    return ResponseFormatter.paginated(res, { items: formattedItems, page, limit, total });
  } catch (err) {
    next(err);
  }
}
