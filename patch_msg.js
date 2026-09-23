import fs from 'fs';
const file = './services/messaging-service/src/services/messagingService.js';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  `export async function blockUser(auth, targetUserId) {
  if (auth.userId === targetUserId) {`,
  `export async function blockUser(auth, targetUserId) {
  const db = getDb();
  let actualUserId = targetUserId;
  const targetUser = await db.user.findUnique({ where: { id: actualUserId } });
  if (!targetUser) {
    const expert = await db.expertProfile.findUnique({ where: { id: actualUserId } });
    if (expert) actualUserId = expert.userId;
    else {
      const customer = await db.customerProfile.findUnique({ where: { id: actualUserId } });
      if (customer) actualUserId = customer.userId;
    }
  }
  targetUserId = actualUserId;
  if (auth.userId === targetUserId) {`
);

code = code.replace(
  `export async function unblockUser(auth, targetUserId) {
  const db = getDb();`,
  `export async function unblockUser(auth, targetUserId) {
  const db = getDb();
  let actualUserId = targetUserId;
  const targetUser = await db.user.findUnique({ where: { id: actualUserId } });
  if (!targetUser) {
    const expert = await db.expertProfile.findUnique({ where: { id: actualUserId } });
    if (expert) actualUserId = expert.userId;
    else {
      const customer = await db.customerProfile.findUnique({ where: { id: actualUserId } });
      if (customer) actualUserId = customer.userId;
    }
  }
  targetUserId = actualUserId;`
);

fs.writeFileSync(file, code);
console.log("Patched messagingService.js");

const socketFile = './services/messaging-service/src/sockets/messagingSocket.js';
let socketCode = fs.readFileSync(socketFile, 'utf8');
socketCode = socketCode.replace(
  `const data = await svc.blockUser(auth, targetUserId);
        if (typeof callback === "function") {
          callback({ success: true, data });
        }`,
  `const data = await svc.blockUser(auth, targetUserId);
        // Broadcast to both users that block status changed
        io.to(\`user:\${auth.userId}\`).to(\`user:\${targetUserId}\`).emit("user:blocked", {
          blockerUserId: auth.userId,
          blockedUserId: targetUserId,
        });
        if (typeof callback === "function") {
          callback({ success: true, data });
        }`
);

socketCode = socketCode.replace(
  `const data = await svc.unblockUser(auth, targetUserId);
        if (typeof callback === "function") {
          callback({ success: true, data });
        }`,
  `const data = await svc.unblockUser(auth, targetUserId);
        io.to(\`user:\${auth.userId}\`).to(\`user:\${targetUserId}\`).emit("user:unblocked", {
          blockerUserId: auth.userId,
          blockedUserId: targetUserId,
        });
        if (typeof callback === "function") {
          callback({ success: true, data });
        }`
);

fs.writeFileSync(socketFile, socketCode);
console.log("Patched messagingSocket.js");
