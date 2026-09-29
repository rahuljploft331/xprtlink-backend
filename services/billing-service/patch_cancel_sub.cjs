const fs = require('fs');
const file = 'src/services/billingService.js';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  `      data: { subscriptionId: updated.id, planId: updated.planId },
    });`,
  `      data: { subscriptionId: updated.id, planId: updated.planId },
    });

    const userEmail = (await getDb().user.findUnique({ where: { id: auth.userId }, select: { email: true } }))?.email;
    if (userEmail) {
      const emailHtml = await renderEmailTemplate({
        title: "Subscription Cancellation Scheduled",
        bodyHtml: \`<p>Your \${updated.plan.name} subscription will be cancelled on \${periodEnd}. You retain access until then.</p>\`,
        ctaText: "View Subscription",
        ctaUrl: process.env.APP_DEEP_LINK_URL ?? "https://expert.xprtlink.com",
      });
      await sendEmail({
        to: userEmail,
        subject: "Subscription Cancellation Scheduled",
        html: emailHtml,
      });
    }`
);

fs.writeFileSync(file, content, 'utf8');
console.log("Patched cancelSubscription");
