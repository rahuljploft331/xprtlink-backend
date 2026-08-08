import { test } from "node:test";
import assert from "node:assert/strict";

const BASE_URL = "http://localhost:4000/api/v1";

async function postJson(endpoint, data, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function getJson(endpoint, token) {
  const headers = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}/${endpoint}`, {
    method: "GET",
    headers,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function runCustomerSignupTest() {
  console.log("==================================================================");
  console.log("🚀 TESTING FIGMA CUSTOMER ONBOARDING & SIGNUP FLOW (END-TO-END)");
  console.log("==================================================================");

  const timestamp = Date.now();
  const testEmail = `customer_${timestamp}@xpertlink.com`;
  const testPhone = `+1415${String(timestamp).slice(-7)}`;

  // 1. Splash & App Config (Figma Canvas: UI Design -> Splash)
  console.log("\n[1] Testing Splash & App Config (Figma: Splash)");
  const appConfig = await getJson("catalog/app-config");
  assert.equal(appConfig.status, 200);
  assert.equal(appConfig.body.success, true);
  console.log("  ✓ App Config validated: minAppVersion =", appConfig.body.data.minAppVersion);

  // 2. Real-time Field Availability Check (Figma: Sign Up Form)
  console.log("\n[2] Testing Email Availability Check (Figma: Sign Up Form)");
  const avail = await getJson(`auth/check-availability?email=${testEmail}`);
  assert.equal(avail.status, 200);
  assert.equal(avail.body.data.emailAvailable, true);
  console.log("  ✓ Email availability check: emailAvailable = true");

  // 3. Validation Rules (Figma: Sign Up Form - Error State)
  console.log("\n[3] Testing Sign Up Form Validation & Password Policy");
  const invalidSignup = await postJson("auth/register", {
    email: testEmail,
    phone: testPhone,
    password: "weak",
    confirmPassword: "weak",
    firstName: "John",
    lastName: "Doe",
    role: "customer",
    termsAccepted: false,
  });
  assert.equal(invalidSignup.status, 400);
  assert.equal(invalidSignup.body.success, false);
  assert.equal(invalidSignup.body.code, "VALIDATION_ERROR");
  console.log("  ✓ Correctly rejected weak password & unaccepted terms with HTTP 400 VALIDATION_ERROR");

  // 4. Valid Registration Submission (Figma: Sign Up Screen)
  console.log("\n[4] Submitting Valid Customer Sign Up (Figma: Sign Up Screen)");
  const signup = await postJson("auth/register", {
    email: testEmail,
    phone: testPhone,
    password: "Password123!",
    confirmPassword: "Password123!",
    firstName: "John",
    lastName: "Doe",
    role: "customer",
    termsAccepted: true,
    otpChannel: "phone",
  });
  assert.equal(signup.status, 201);
  assert.equal(signup.body.success, true);
  assert.equal(signup.body.data.sent, true);
  console.log("  ✓ Customer created in pending_verification state; OTP dispatched to phone.");

  // 5. Invalid OTP Verification (Figma: Verify Email / OTP - Error State)
  console.log("\n[5] Testing Incorrect OTP Input (Figma: Verify Email - Error Screen)");
  const badOtp = await postJson("auth/otp/verify", {
    phone: testPhone,
    code: "000000",
    purpose: "register",
  });
  assert.equal(badOtp.status, 400);
  assert.equal(badOtp.body.code, "INVALID_OTP");
  console.log("  ✓ Rejected invalid OTP code with error code INVALID_OTP.");

  // 6. Resend OTP Action (Figma: Verify Email - Resend Screen)
  console.log("\n[6] Testing Resend OTP Action (Figma: Verify Email - Resend)");
  const resend = await postJson("auth/otp/resend", {
    phone: testPhone,
    purpose: "verify_phone",
  });
  assert.equal(resend.status, 200);
  assert.equal(resend.body.success, true);
  console.log("  ✓ OTP code resent successfully.");

  // 7. Successful OTP Verification (Figma: Account Created Successfully)
  console.log("\n[7] Verifying Correct OTP (Figma: Account Created Successfully)");
  const verify = await postJson("auth/otp/verify", {
    phone: testPhone,
    code: "123456",
    purpose: "register",
  });
  assert.equal(verify.status, 200);
  assert.equal(verify.body.success, true);
  const { accessToken, refreshToken, session } = verify.body.data;
  assert.ok(accessToken, "accessToken should be present");
  assert.ok(refreshToken, "refreshToken should be present");
  assert.equal(session.role, "customer");
  assert.equal(session.hasCustomerProfile, true);
  assert.equal(session.gates.emailVerified, true);
  assert.equal(session.gates.phoneVerified, true);
  console.log("  ✓ Customer verified! Tokens issued, customer profile initialized.");

  // 8. Session Validation Gate (Figma: Splash / Session Gate)
  console.log("\n[8] Validating Active Customer Session (Figma: Splash Gate)");
  const sessionCheck = await getJson("auth/session", accessToken);
  assert.equal(sessionCheck.status, 200);
  assert.equal(sessionCheck.body.data.role, "customer");
  assert.equal(sessionCheck.body.data.hasCustomerProfile, true);
  console.log("  ✓ Session valid. Customer role & profile gates confirmed.");

  // 9. Customer Profile Hub Load (Figma: Profile Main Hub / Dashboard)
  console.log("\n[9] Loading Customer Profile (Figma: Profile - Main Hub)");
  const profile = await getJson("customers/me", accessToken);
  assert.equal(profile.status, 200);
  assert.equal(profile.body.data.firstName, "John");
  assert.equal(profile.body.data.lastName, "Doe");
  assert.equal(profile.body.data.status, "active");
  console.log(`  ✓ Loaded Customer Profile: ${profile.body.data.firstName} ${profile.body.data.lastName} (${profile.body.data.email})`);

  // 10. Refresh Token Cycle (Silent Renew)
  console.log("\n[10] Testing Refresh Token Cycle (Silent Session Refresh)");
  const refresh = await postJson("auth/refresh", {
    refreshToken,
    role: "customer",
  });
  assert.equal(refresh.status, 200);
  assert.ok(refresh.body.data.accessToken);
  console.log("  ✓ Successfully rotated tokens using refresh token.");

  console.log("\n==================================================================");
  console.log("🎉 ALL 10 CUSTOMER ONBOARDING & SIGNUP STEPS PASSED SUCCESSFULLY!");
  console.log("==================================================================\n");
}

runCustomerSignupTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
