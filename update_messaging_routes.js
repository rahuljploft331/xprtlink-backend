import fs from 'fs';
const file = './services/messaging-service/src/routes/index.js';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('internal/events/user-blocked')) {
  code = code.replace(
    `export default router;`,
    `
import { getIo } from "../sockets/messagingSocket.js";

router.post("/internal/events/user-blocked", (req, res) => {
  const { blockerUserId, blockedUserId } = req.body;
  const io = getIo();
  if (io) {
    io.to(\`user:\${blockerUserId}\`).to(\`user:\${blockedUserId}\`).emit("user:blocked", {
      blockerUserId,
      blockedUserId,
    });
  }
  return res.json({ success: true });
});

router.post("/internal/events/user-unblocked", (req, res) => {
  const { blockerUserId, blockedUserId } = req.body;
  const io = getIo();
  if (io) {
    io.to(\`user:\${blockerUserId}\`).to(\`user:\${blockedUserId}\`).emit("user:unblocked", {
      blockerUserId,
      blockedUserId,
    });
  }
  return res.json({ success: true });
});

export default router;`
  );
  fs.writeFileSync(file, code);
  console.log("Updated messaging routes.");
} else {
  console.log("Already updated.");
}
