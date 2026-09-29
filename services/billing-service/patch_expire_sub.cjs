const fs = require('fs');
const file = 'src/services/billingService.js';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  `        await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
          userIds,
          type: "subscription_expired",
          title: "Subscription Expired",
          body: "Your expert subscription has expired. Renew now to stay discoverable on XpertLink.",
          data: {},
        });`,
  `        await internalPost(notifUrl, "/api/v1/notifications/dispatch", {
          userIds,
          type: "subscription_expired",
          title: "Subscription Expired",
          body: "Your expert subscription has expired. Renew now to stay discoverable on XpertLink.",
          data: {},
        });

        const users = await db2.user.findMany({ where: { id: { in: userIds } }, select: { email: true } });
        for (const u of users) {
          if (u.email) {
            const emailHtml = await renderEmailTemplate({
              title: "Subscription Expired",
              bodyHtml: "<p>Your expert subscription has expired. Renew now to stay discoverable on XpertLink.</p>",
              ctaText: "Renew Subscription",
              ctaUrl: process.env.APP_DEEP_LINK_URL ?? "https://expert.xprtlink.com",
            });
            await sendEmail({
              to: u.email,
              subject: "Subscription Expired",
              html: emailHtml,
            }).catch(e => log.error(e));
          }
        }`
);

fs.writeFileSync(file, content, 'utf8');
console.log("Patched expireSubscriptions");
