const fs = require('fs');
const file = 'src/services/engagementService.js';
let content = fs.readFileSync(file, 'utf8');

// 321: quote_received
content = content.replace(
  `      data: { quoteId: quote.id, referenceNumber: quote.referenceNumber },
    });`,
  `      data: { quoteId: quote.id, referenceNumber: quote.referenceNumber },
    });
    if (quote.expert?.user?.email) {
      const emailHtml = await renderEmailTemplate({
        title: "New Quote Request",
        bodyHtml: \`<p>\${customerName} sent you a new quote request: "\${quote.title}"</p>\`,
        ctaText: "Review Quote",
        ctaUrl: \`\${process.env.APP_DEEP_LINK_URL ?? "https://expert.xprtlink.com"}/quotes/\${quote.id}\`,
      });
      await sendEmail({ to: quote.expert.user.email, subject: "New Quote Request", html: emailHtml }).catch(e => log.error(e));
    }`
);

// 547: quote_submitted
content = content.replace(
  `      data: { quoteId: updated.id, referenceNumber: updated.referenceNumber },
    });`,
  `      data: { quoteId: updated.id, referenceNumber: updated.referenceNumber },
    });
    if (updated.customer?.user?.email) {
      const emailHtml = await renderEmailTemplate({
        title: "Quote Ready",
        bodyHtml: \`<p>\${expertName} has sent you a quote for "\${updated.title}"</p>\`,
        ctaText: "View Quote",
        ctaUrl: \`\${process.env.APP_DEEP_LINK_URL ?? "https://app.xprtlink.com"}/quotes/\${updated.id}\`,
      });
      await sendEmail({ to: updated.customer.user.email, subject: "Quote Ready", html: emailHtml }).catch(e => log.error(e));
    }`
);

// 586: quote_accepted
content = content.replace(
  `      data: { quoteId: updated.id, referenceNumber: updated.referenceNumber },
    });`,
  `      data: { quoteId: updated.id, referenceNumber: updated.referenceNumber },
    });
    if (updated.expert?.user?.email) {
      const emailHtml = await renderEmailTemplate({
        title: "Quote Accepted",
        bodyHtml: \`<p>\${customerName} accepted your quote for "\${updated.title}"</p>\`,
        ctaText: "View Quote",
        ctaUrl: \`\${process.env.APP_DEEP_LINK_URL ?? "https://expert.xprtlink.com"}/quotes/\${updated.id}\`,
      });
      await sendEmail({ to: updated.expert.user.email, subject: "Quote Accepted", html: emailHtml }).catch(e => log.error(e));
    }`
);

// 624: quote_rejected
content = content.replace(
  `      data: { quoteId: updated.id, referenceNumber: updated.referenceNumber },
    });`,
  `      data: { quoteId: updated.id, referenceNumber: updated.referenceNumber },
    });
    if (updated.expert?.user?.email) {
      const emailHtml = await renderEmailTemplate({
        title: "Quote Rejected",
        bodyHtml: \`<p>\${customerName} rejected your quote for "\${updated.title}"</p>\`,
        ctaText: "View Quote",
        ctaUrl: \`\${process.env.APP_DEEP_LINK_URL ?? "https://expert.xprtlink.com"}/quotes/\${updated.id}\`,
      });
      await sendEmail({ to: updated.expert.user.email, subject: "Quote Rejected", html: emailHtml }).catch(e => log.error(e));
    }`
);

// 662: quote_cancelled
content = content.replace(
  `      data: { quoteId: updated.id, referenceNumber: updated.referenceNumber },
    });`,
  `      data: { quoteId: updated.id, referenceNumber: updated.referenceNumber },
    });
    if (updated.expert?.user?.email) {
      const emailHtml = await renderEmailTemplate({
        title: "Quote Cancelled",
        bodyHtml: \`<p>\${customerName} cancelled their quote request: "\${updated.title}"</p>\`,
        ctaText: "View Quote",
        ctaUrl: \`\${process.env.APP_DEEP_LINK_URL ?? "https://expert.xprtlink.com"}/quotes/\${updated.id}\`,
      });
      await sendEmail({ to: updated.expert.user.email, subject: "Quote Cancelled", html: emailHtml }).catch(e => log.error(e));
    }`
);

// 874: consultation_requested
content = content.replace(
  `      data: { consultationId: consultation.id },
    });`,
  `      data: { consultationId: consultation.id },
    });
    if (consultation.expert?.user?.email) {
      const emailHtml = await renderEmailTemplate({
        title: "Incoming Consultation Request",
        bodyHtml: \`<p>\${customerName} is requesting a consultation with you.</p>\`,
        ctaText: "View Request",
        ctaUrl: \`\${process.env.APP_DEEP_LINK_URL ?? "https://expert.xprtlink.com"}/consultations/\${consultation.id}\`,
      });
      await sendEmail({ to: consultation.expert.user.email, subject: "Incoming Consultation Request", html: emailHtml }).catch(e => log.error(e));
    }`
);

// 1042: consultation_declined
content = content.replace(
  `      data: { consultationId: updated.id },
    });`,
  `      data: { consultationId: updated.id },
    });
    if (updated.customer?.user?.email) {
      const emailHtml = await renderEmailTemplate({
        title: "Consultation Declined",
        bodyHtml: \`<p>\${expertName} is currently unavailable and declined your request.</p>\`,
        ctaText: "View Consultation",
        ctaUrl: \`\${process.env.APP_DEEP_LINK_URL ?? "https://app.xprtlink.com"}/consultations/\${updated.id}\`,
      });
      await sendEmail({ to: updated.customer.user.email, subject: "Consultation Declined", html: emailHtml }).catch(e => log.error(e));
    }`
);

fs.writeFileSync(file, content, 'utf8');
console.log("Patched engagementService");
