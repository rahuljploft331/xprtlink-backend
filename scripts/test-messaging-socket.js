import { io } from "socket.io-client";
import { getDb } from "../shared/db/getClient.js";
import { signAccessToken } from "../shared/auth/jwt.js";

async function main() {
  console.log("=== Testing WebSocket-Only Messaging Service ===");

  const db = getDb();

  // Find a customer and an expert
  const customer = await db.customerProfile.findFirst({
    include: { user: true },
  });
  const expert = await db.expertProfile.findFirst({
    include: { user: true },
  });

  if (!customer || !expert) {
    console.error("Please run db seed first: Customer or Expert profile not found");
    process.exit(1);
  }

  console.log(`Customer: ${customer.user.email} (ID: ${customer.id}, User: ${customer.userId})`);
  console.log(`Expert:   ${expert.user.email} (ID: ${expert.id}, User: ${expert.userId})`);

  // Generate tokens
  const customerToken = signAccessToken({
    sub: customer.userId,
    role: "customer",
    customerProfileId: customer.id,
  });

  const expertToken = signAccessToken({
    sub: expert.userId,
    role: "expert",
    expertProfileId: expert.id,
  });

  // Test Connection 1: Connect to messaging-service (direct port 4005) or Gateway (port 4000)
  const targetUrl = process.env.GATEWAY_URL || "http://localhost:4005";
  console.log(`\nConnecting to: ${targetUrl}...`);

  const customerSocket = io(targetUrl, {
    auth: { token: customerToken },
    transports: ["websocket", "polling"],
  });

  const expertSocket = io(targetUrl, {
    auth: { token: expertToken },
    transports: ["websocket", "polling"],
  });

  await Promise.all([
    new Promise((resolve, reject) => {
      customerSocket.on("connect", () => {
        console.log("✅ Customer socket connected:", customerSocket.id);
        resolve();
      });
      customerSocket.on("connect_error", (err) => reject(new Error("Customer connect failed: " + err.message)));
    }),
    new Promise((resolve, reject) => {
      expertSocket.on("connect", () => {
        console.log("✅ Expert socket connected:", expertSocket.id);
        resolve();
      });
      expertSocket.on("connect_error", (err) => reject(new Error("Expert connect failed: " + err.message)));
    }),
  ]);

  // Step 1: Create or get conversation
  console.log("\n[1] Customer creates/gets conversation with expert...");
  const convRes = await new Promise((resolve) => {
    customerSocket.emit("conversation:create", { expertId: expert.id }, resolve);
  });
  console.log("conversation:create response:", convRes);
  if (!convRes.success) throw new Error("Create conversation failed");
  const conversationId = convRes.data.id;

  // Step 2: List conversations
  console.log("\n[2] Listing conversations for customer...");
  const listRes = await new Promise((resolve) => {
    customerSocket.emit("conversation:list", {}, resolve);
  });
  console.log(`conversation:list response: found ${listRes.data?.items?.length} items`);

  // Step 3: Join conversation rooms
  console.log("\n[3] Joining conversation room:", conversationId);
  const joinRes1 = await new Promise((resolve) => {
    customerSocket.emit("conversation:join", { conversationId }, resolve);
  });
  const joinRes2 = await new Promise((resolve) => {
    expertSocket.emit("conversation:join", { conversationId }, resolve);
  });
  console.log("Customer join:", joinRes1);
  console.log("Expert join:", joinRes2);

  // Setup listeners for real-time events
  const messageReceivedPromise = new Promise((resolve) => {
    expertSocket.on("message:new", (data) => {
      console.log("✅ Expert received real-time 'message:new':", data);
      resolve(data);
    });
  });

  const typingPromise = new Promise((resolve) => {
    customerSocket.on("typing:status", (data) => {
      console.log("✅ Customer received real-time 'typing:status':", data);
      resolve(data);
    });
  });

  const readPromise = new Promise((resolve) => {
    customerSocket.on("conversation:read", (data) => {
      console.log("✅ Customer received real-time 'conversation:read':", data);
      resolve(data);
    });
  });

  // Step 4: Send a message from Customer
  console.log("\n[4] Customer sends message...");
  const sendRes = await new Promise((resolve) => {
    customerSocket.emit(
      "message:send",
      {
        conversationId,
        body: "Hello expert! Testing real-time WebSocket messaging via Socket.IO.",
      },
      resolve
    );
  });
  console.log("message:send response:", sendRes);
  if (!sendRes.success) throw new Error("Send message failed");

  // Wait for expert to receive message
  await messageReceivedPromise;

  // Step 5: Expert types
  console.log("\n[5] Expert starts typing...");
  expertSocket.emit("typing:start", { conversationId });
  await typingPromise;
  expertSocket.emit("typing:stop", { conversationId });

  // Step 6: Expert marks message as read
  console.log("\n[6] Expert marks conversation read...");
  const readRes = await new Promise((resolve) => {
    expertSocket.emit("message:read", { conversationId }, resolve);
  });
  console.log("message:read response:", readRes);
  await readPromise;

  // Step 7: Load message history
  console.log("\n[7] Fetching message history...");
  const historyRes = await new Promise((resolve) => {
    customerSocket.emit("message:history", { conversationId, page: 1, limit: 10 }, resolve);
  });
  console.log(`message:history response: found ${historyRes.data?.items?.length} messages`);

  // Step 8: Clean up
  customerSocket.emit("conversation:leave", { conversationId });
  expertSocket.emit("conversation:leave", { conversationId });

  customerSocket.disconnect();
  expertSocket.disconnect();

  console.log("\n🎉 ALL WEBSOCKET TESTS PASSED SUCCESSFULLY!");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
