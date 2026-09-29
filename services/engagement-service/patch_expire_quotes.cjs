const fs = require('fs');
const file = 'src/crons/expireQuotes.js';
let content = fs.readFileSync(file, 'utf8');

if (!content.includes('renderEmailTemplate')) {
  content = content.replace(
    'import { getMessage } from "@xprtlink/shared/utils/messages.js";',
    'import { getMessage } from "@xprtlink/shared/utils/messages.js";\nimport { sendEmail, renderEmailTemplate } from "@xprtlink/shared/lib/email.js";'
  );
}

content = content.replace(
  `      internalPost(notifUrl, "/api/v1/notifications/dispatch", {
        userIds: customerIds,
        type: "quote_expired",
        title: "Quote Expired",
        body: getMessage("quoteExpiredCustomer"),
        data: {},
      }).catch((err) => log.error({ err: err.message }, "[cron] Failed to notify customers:"));`,
  `      internalPost(notifUrl, "/api/v1/notifications/dispatch", {
        userIds: customerIds,
        type: "quote_expired",
        title: "Quote Expired",
        body: getMessage("quoteExpiredCustomer"),
        data: {},
      }).catch((err) => log.error({ err: err.message }, "[cron] Failed to notify customers:"));

      getDb().user.findMany({ where: { customerProfile: { id: { in: customerIds } } }, select: { email: true } })
        .then(async (users) => {
          for (const u of users) {
            if (u.email) {
              const html = await renderEmailTemplate({
                title: "Quote Expired",
                bodyHtml: \`<p>\${getMessage("quoteExpiredCustomer")}</p>\`,
                ctaText: "Open App",
                ctaUrl: process.env.APP_DEEP_LINK_URL ?? "https://app.xprtlink.com",
              });
              await sendEmail({ to: u.email, subject: "Quote Expired", html }).catch(e => log.error(e));
            }
          }
        });`
);

content = content.replace(
  `      internalPost(notifUrl, "/api/v1/notifications/dispatch", {
        userIds: expertIds,
        type: "quote_expired",
        title: "Quote Expired",
        body: getMessage("quoteExpiredExpert"),
        data: {},
      }).catch((err) => log.error({ err: err.message }, "[cron] Failed to notify experts:"));`,
  `      internalPost(notifUrl, "/api/v1/notifications/dispatch", {
        userIds: expertIds,
        type: "quote_expired",
        title: "Quote Expired",
        body: getMessage("quoteExpiredExpert"),
        data: {},
      }).catch((err) => log.error({ err: err.message }, "[cron] Failed to notify experts:"));

      getDb().user.findMany({ where: { expertProfile: { id: { in: expertIds } } }, select: { email: true } })
        .then(async (users) => {
          for (const u of users) {
            if (u.email) {
              const html = await renderEmailTemplate({
                title: "Quote Expired",
                bodyHtml: \`<p>\${getMessage("quoteExpiredExpert")}</p>\`,
                ctaText: "Open App",
                ctaUrl: process.env.APP_DEEP_LINK_URL ?? "https://expert.xprtlink.com",
              });
              await sendEmail({ to: u.email, subject: "Quote Expired", html }).catch(e => log.error(e));
            }
          }
        });`
);


fs.writeFileSync(file, content, 'utf8');
console.log("Patched expireQuotes");
