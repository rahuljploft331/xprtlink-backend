import fs from 'fs';
const file = './shared/mappers/messaging.mapper.js';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('isBlocked')) {
  code = code.replace(
    `  { peerName, peerAvatarUrl, unreadCount, lastMessage }`,
    `  { peerName, peerAvatarUrl, unreadCount, lastMessage, isBlocked, blockedByMe }`
  ).replace(
    `    unreadCount,`,
    `    unreadCount,\n    isBlocked: isBlocked ?? false,\n    blockedByMe: blockedByMe ?? false,`
  );
  fs.writeFileSync(file, code);
  console.log("Patched DTO");
}
