import fs from 'fs';
const file = './services/messaging-service/src/routes/index.js';
let code = fs.readFileSync(file, 'utf8');

code = code.replace(
  `io.to(\`user:\${blockerUserId}\`).to(\`user:\${blockedUserId}\`).emit("user:blocked", {`,
  `console.log("EMITTING user:blocked", { blockerUserId, blockedUserId, blockerProfileIds, blockedProfileIds });
    io.to(\`user:\${blockerUserId}\`).to(\`user:\${blockedUserId}\`).emit("user:blocked", {`
);

fs.writeFileSync(file, code);
