import fs from 'fs';
const file = './services/messaging-service/src/routes/index.js';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  `  const { blockerUserId, blockedUserId } = req.body;
  const io = getIo();
  if (io) {
    io.to(\`user:\${blockerUserId}\`).to(\`user:\${blockedUserId}\`).emit("user:blocked", {
      blockerUserId,
      blockedUserId,
    });`,
  `  const { blockerUserId, blockedUserId, blockerProfileIds, blockedProfileIds } = req.body;
  const io = getIo();
  if (io) {
    io.to(\`user:\${blockerUserId}\`).to(\`user:\${blockedUserId}\`).emit("user:blocked", {
      blockerUserId,
      blockedUserId,
      blockerProfileIds,
      blockedProfileIds,
    });`
);

code = code.replace(
  `  const { blockerUserId, blockedUserId } = req.body;
  const io = getIo();
  if (io) {
    io.to(\`user:\${blockerUserId}\`).to(\`user:\${blockedUserId}\`).emit("user:unblocked", {
      blockerUserId,
      blockedUserId,
    });`,
  `  const { blockerUserId, blockedUserId, blockerProfileIds, blockedProfileIds } = req.body;
  const io = getIo();
  if (io) {
    io.to(\`user:\${blockerUserId}\`).to(\`user:\${blockedUserId}\`).emit("user:unblocked", {
      blockerUserId,
      blockedUserId,
      blockerProfileIds,
      blockedProfileIds,
    });`
);

fs.writeFileSync(file, code);
console.log("Patched messaging-service internal routes");
