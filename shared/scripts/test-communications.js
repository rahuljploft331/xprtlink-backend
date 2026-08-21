import "dotenv/config";
import sgMail from "@sendgrid/mail";
import twilio from "twilio";

const args = process.argv.slice(2);
const command = args[0]; // 'email', 'sms', or 'verify-sms'
const target = args[1];  // email address or phone number
const code = args[2];    // code for 'verify-sms'

async function testEmail() {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL || "noreply@xpertlink.local";

  if (!apiKey) {
    console.error("❌ SENDGRID_API_KEY is not set in environment.");
    process.exit(1);
  }
  if (!target) {
    console.error("❌ Please provide a target email address. Example: pnpm test:email user@example.com");
    process.exit(1);
  }

  sgMail.setApiKey(apiKey);
  console.log(`✉️  Sending test email to ${target} from ${fromEmail}...`);

  try {
    await sgMail.send({
      to: target,
      from: fromEmail,
      subject: "XprtLink - SendGrid Integration Test",
      text: "This is a test email to verify that your SendGrid integration is working perfectly.",
      html: "<p>This is a test email to verify that your <strong>SendGrid</strong> integration is working perfectly.</p>",
    });
    console.log("✅ Email sent successfully! Check your inbox.");
  } catch (error) {
    console.error("❌ Failed to send email:");
    console.error(error.response ? error.response.body : error);
  }
}

async function testSms() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

  if (!accountSid || !authToken || !serviceSid) {
    console.error("❌ TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_VERIFY_SERVICE_SID is missing.");
    process.exit(1);
  }
  if (!target) {
    console.error("❌ Please provide a target phone number. Example: pnpm test:phone +1234567890");
    process.exit(1);
  }

  const client = twilio(accountSid, authToken);
  console.log(`📱 Requesting Twilio Verify SMS to ${target} via service ${serviceSid}...`);

  try {
    const verification = await client.verify.v2.services(serviceSid).verifications.create({
      to: target,
      channel: "sms",
    });
    console.log(`✅ Verification requested successfully! Status: ${verification.status}`);
    console.log(`To verify the code you receive, run:`);
    console.log(`  pnpm test:verify-phone ${target} <your-code>`);
  } catch (error) {
    console.error("❌ Failed to send Twilio Verify SMS:");
    console.error(error);
  }
}

async function verifySmsCode() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;

  if (!accountSid || !authToken || !serviceSid) {
    console.error("❌ TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_VERIFY_SERVICE_SID is missing.");
    process.exit(1);
  }
  if (!target || !code) {
    console.error("❌ Please provide a phone number and the code. Example: pnpm test:verify-phone +1234567890 123456");
    process.exit(1);
  }

  const client = twilio(accountSid, authToken);
  console.log(`🔍 Checking Twilio Verify code ${code} for ${target}...`);

  try {
    const check = await client.verify.v2.services(serviceSid).verificationChecks.create({
      to: target,
      code: code,
    });
    
    if (check.status === "approved") {
      console.log(`✅ Code is valid! Status: ${check.status}`);
    } else {
      console.log(`❌ Code is invalid or expired. Status: ${check.status}`);
    }
  } catch (error) {
    console.error("❌ Failed to verify code:");
    console.error(error);
  }
}

function printHelp() {
  console.log(`
XprtLink Communications Test Script
===================================
Make sure your environment variables are set (in .env or passed inline):
  - SENDGRID_API_KEY
  - SENDGRID_FROM_EMAIL (optional, defaults to noreply@xpertlink.local)
  - TWILIO_ACCOUNT_SID
  - TWILIO_AUTH_TOKEN
  - TWILIO_VERIFY_SERVICE_SID

Usage:
  pnpm test:email <email_address>
  pnpm test:phone <phone_number>
  pnpm test:verify-phone <phone_number> <6_digit_code>
`);
}

switch (command) {
  case "email":
    testEmail();
    break;
  case "sms":
    testSms();
    break;
  case "verify-sms":
    verifySmsCode();
    break;
  default:
    printHelp();
    break;
}
