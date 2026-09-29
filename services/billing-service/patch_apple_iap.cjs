const fs = require('fs');
const file = 'src/controllers/appleIapController.js';
let content = fs.readFileSync(file, 'utf8');

// Add import if not present
if (!content.includes('renderEmailTemplate')) {
  content = content.replace(
    'import { getDb } from "@xprtlink/shared/db/getClient.js";',
    'import { getDb } from "@xprtlink/shared/db/getClient.js";\nimport { sendEmail, renderEmailTemplate } from "@xprtlink/shared/lib/email.js";'
  );
}

content = content.replace(
  `        data: { subscriptionId: subscription.id, planId: subscription.planId },
      });`,
  `        data: { subscriptionId: subscription.id, planId: subscription.planId },
      });

      const userEmail = (await getDb().user.findUnique({ where: { id: req.user.userId }, select: { email: true } }))?.email;
      if (userEmail) {
        const emailHtml = await renderEmailTemplate({
          title: "Subscription Activated",
          bodyHtml: \`<p>Your \${subscription.plan.name} plan is now active via Apple.</p>\`,
          ctaText: "View Subscription",
          ctaUrl: process.env.APP_DEEP_LINK_URL ?? "https://expert.xprtlink.com",
        });
        await sendEmail({
          to: userEmail,
          subject: "Subscription Activated",
          html: emailHtml,
        });
      }`
);

fs.writeFileSync(file, content, 'utf8');
console.log("Patched appleIapController");
