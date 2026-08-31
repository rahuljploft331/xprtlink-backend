/**
 * Flow G: Messaging Chat (Socket.IO driver)
 *
 * XprtLink chat is a Socket.IO / WebSocket protocol ONLY — the messaging-service
 * exposes no REST routes for conversations or messages (see
 * services/messaging-service/src/routes/index.js which returns "websocket protocol
 * only", and the events registered in sockets/messagingSocket.js).
 *
 * Newman/Postman cannot drive a Socket.IO handshake + ack-callback event API, so
 * this flow is validated with a socket.io-client driver instead of a *.flow.json
 * collection. REST setup (register / OTP / onboarding) still goes through the
 * gateway; the chat exchange goes over the socket.
 *
 * Exit code 0 = all assertions passed, 1 = a failure occurred.
 *
 * Usage: node scripts/flows/messaging-chat.socket.mjs [base_url]
 */
import { io } from "socket.io-client";

const BASE = process.argv[2] || process.env.BASE_URL || "http://localhost:4000";
const OTP = "123456";

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    passed++;
    console.log(`  \u2713  ${name}`);
  } else {
    failed++;
    console.log(`  \u2717  ${name}`);
  }
}

async function http(path, method, body, token) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function verifyPhone(phone) {
  await http("/api/v1/auth/otp/send", "POST", { phone, purpose: "verify_phone" });
  await http("/api/v1/auth/otp/verify", "POST", { phone, code: OTP, purpose: "verify_phone" });
}

async function registerAndToken({ role, otpChannel, phonePrefix }) {
  const ts = Date.now() + Math.floor(Math.random() * 1000);
  const email = `flowg.${role}.${ts}@yopmail.com`;
  const phone = phonePrefix + String(ts).slice(-7);
  await verifyPhone(phone);
  await http("/api/v1/auth/register", "POST", {
    email, phone, password: "Passw0rd@123", confirmPassword: "Passw0rd@123",
    firstName: "Flow", lastName: role === "customer" ? "Customer" : "Expert",
    role, termsAccepted: true, otpChannel,
  });
  const idKey = otpChannel === "email" ? { email } : { phone };
  const v = await http("/api/v1/auth/otp/verify", "POST", { ...idKey, code: OTP, purpose: "register" });
  return v.json.data?.accessToken;
}

function emit(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("ack timeout: " + event)), 8000);
    socket.emit(event, payload, (ack) => { clearTimeout(t); resolve(ack); });
  });
}

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { auth: { token }, transports: ["websocket"], reconnection: false });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (e) => reject(new Error("connect_error: " + e.message)));
    setTimeout(() => reject(new Error("connect timeout")), 8000);
  });
}

async function main() {
  console.log("XprtLink Messaging Chat Flow (Socket.IO) @ " + BASE);

  // ── REST setup ────────────────────────────────────────────────────────────
  console.log("\u2192 Setup: register customer + expert, onboard expert");
  const custToken = await registerAndToken({ role: "customer", otpChannel: "phone", phonePrefix: "+1415" });
  const expToken = await registerAndToken({ role: "expert", otpChannel: "email", phonePrefix: "+1617" });
  check("customer token issued", typeof custToken === "string" && custToken.length > 0);
  check("expert token issued", typeof expToken === "string" && expToken.length > 0);

  const cats = await http("/api/v1/catalog/categories", "GET");
  const catId = cats.json.data?.[0]?.id;
  await http("/api/v1/experts/me/onboarding/submit", "POST",
    { bio: "Messaging flow expert.", headline: "Chat Specialist", consultationRate: 80, experienceYears: 3, categoryId: catId },
    expToken);
  const me = await http("/api/v1/experts/me", "GET", null, expToken);
  const expertId = me.json.data?.id;
  check("expert profile id resolved", typeof expertId === "string" && expertId.length > 0);

  // ── Socket connections ──────────────────────────────────────────────────────
  console.log("\u2192 Connect sockets (customer + expert)");
  const cs = await connect(custToken);
  const es = await connect(expToken);
  check("customer socket connected", cs.connected);
  check("expert socket connected", es.connected);

  // expert listens for the incoming message so we assert realtime delivery
  let expertGotMessage = null;
  es.on("message:new", (evt) => { expertGotMessage = evt; });

  // ── Chat exchange ───────────────────────────────────────────────────────────
  console.log("\u2192 Customer creates conversation");
  const conv = await emit(cs, "conversation:create", { expertId });
  check("conversation:create success", conv?.success === true);
  const convId = conv?.data?.id;
  check("conversation has id", typeof convId === "string" && convId.length > 0);

  console.log("\u2192 Expert joins conversation room");
  const joined = await emit(es, "conversation:join", { conversationId: convId });
  check("conversation:join success", joined?.success === true);

  console.log("\u2192 Customer sends first message");
  const m1 = await emit(cs, "message:send", { conversationId: convId, body: "Hello! Are you available this week?" });
  check("message:send success", m1?.success === true);
  check("message body echoed", (m1?.data?.body || "").includes("Hello"));

  console.log("\u2192 Expert replies");
  const m2 = await emit(es, "message:send", { conversationId: convId, body: "Yes, I am available. My rate is $80/hour." });
  check("expert reply success", m2?.success === true);

  // give the realtime broadcast a moment
  await new Promise((r) => setTimeout(r, 300));
  check("expert received realtime message:new", expertGotMessage && expertGotMessage.conversationId === convId);

  console.log("\u2192 Expert marks conversation read");
  const read = await emit(es, "message:read", { conversationId: convId });
  check("message:read success", read?.success === true);

  console.log("\u2192 Verify message history");
  const hist = await emit(cs, "message:history", { conversationId: convId });
  const items = hist?.data?.items || hist?.data || [];
  check("history returned messages", Array.isArray(items) && items.length >= 2);
  const bodies = items.map((m) => m.body).join(" ");
  check("history contains both messages", bodies.includes("Hello") && bodies.includes("available"));

  console.log("\u2192 Verify conversation list");
  const list = await emit(cs, "conversation:list", {});
  const convs = list?.data?.items || list?.data || [];
  check("conversation list has >= 1", Array.isArray(convs) && convs.length >= 1);

  cs.close();
  es.close();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("FLOW G ERROR:", err.message);
  process.exit(1);
});
