import { signAccessToken } from "@xprtlink/shared/auth/jwt.js";
import { io as client } from "socket.io-client";

const URL = "http://localhost:4005";
const DUAL = "11111111-1111-1111-1111-111111111111";
const THIRD = "55555555-5555-5555-5555-555555555555";
const CONV  = "99999999-0000-0000-0000-00000000000e";

const tok = (sub, role, c, e) => signAccessToken({ sub, role, customerProfileId: c, expertProfileId: e });

// Same account, two surfaces. The JWT legitimately carries both profile ids.
const dualCustomer = tok(DUAL, "customer", "22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333");
const dualExpert   = tok(DUAL, "expert",   "22222222-2222-2222-2222-222222222222", "33333333-3333-3333-3333-333333333333");
const thirdCustomer= tok(THIRD,"customer", "66666666-6666-6666-6666-666666666666", "77777777-7777-7777-7777-777777777777");

const connect = (token, label) => new Promise((res, rej) => {
  const s = client(URL, { auth: { token }, transports: ["websocket"], reconnection: false });
  s.received = [];
  for (const ev of ["chat:unread-count","inbox:updated","conversation:read","account:disabled","expert:subscription_expired"])
    s.on(ev, (p) => s.received.push({ ev, p }));
  s.on("connect", () => res(s));
  s.on("connect_error", (e) => rej(new Error(`${label}: ${e.message}`)));
  setTimeout(() => rej(new Error(`${label}: timeout`)), 8000);
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log(`  ✓ ${n}`)) : (fail++, console.log(`  ✗ ${n}`)); };

const cSock = await connect(dualCustomer, "dual-customer");
const eSock = await connect(dualExpert, "dual-expert");
const tSock = await connect(thirdCustomer, "third");
console.log("all three sockets connected\n");
await sleep(600);
cSock.received.length = 0; eSock.received.length = 0;

// Third user messages the conversation where DUAL is the EXPERT.
await new Promise((res) => tSock.emit("message:send", { conversationId: CONV, body: "hello expert" }, res));
await sleep(1200);

const got = (s, ev) => s.received.filter(r => r.ev === ev).length;
console.log("dual-CUSTOMER socket received:", JSON.stringify(cSock.received.map(r=>r.ev)));
console.log("dual-EXPERT   socket received:", JSON.stringify(eSock.received.map(r=>r.ev)));
console.log();
check("expert session got chat:unread-count",      got(eSock,"chat:unread-count") > 0);
check("expert session got inbox:updated",          got(eSock,"inbox:updated") > 0);
check("customer session got NO chat:unread-count", got(cSock,"chat:unread-count") === 0);
check("customer session got NO inbox:updated",     got(cSock,"inbox:updated") === 0);

// Account-level events must still reach BOTH sessions.
cSock.received.length = 0; eSock.received.length = 0;
await fetch(`${URL}/api/internal/events/account-disabled`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-internal-service": process.env.SERVICE_SECRET ?? "" },
  body: JSON.stringify({ userId: DUAL }),
}).catch(e => console.log("  (account-disabled call failed:", e.message, ")"));
await sleep(900);
check("account:disabled reached customer session", got(cSock,"account:disabled") > 0);
check("account:disabled reached expert session",   got(eSock,"account:disabled") > 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
