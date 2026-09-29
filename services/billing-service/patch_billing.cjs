const fs = require('fs');
const file = 'src/services/billingService.js';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  `      data: { consultationId },
    });`,
  `      data: { consultationId },
    });

    if (consultation.customer.user.email) {
      const emailHtml = await renderEmailTemplate({
        title: "Payment Failed",
        bodyHtml: "<p>We were unable to process your consultation payment. Please check your payment method and try again.</p>",
        ctaText: "Update Payment Method",
        ctaUrl: process.env.APP_DEEP_LINK_URL ?? "https://app.xprtlink.com",
      });
      await sendEmail({
        to: consultation.customer.user.email,
        subject: "Consultation Payment Failed",
        html: emailHtml,
      });
    }`
);

fs.writeFileSync(file, content, 'utf8');
console.log("Patched notifyPaymentFailed");
