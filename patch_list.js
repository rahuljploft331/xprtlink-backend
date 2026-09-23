import fs from 'fs';
const file = './services/messaging-service/src/services/messagingService.js';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('const blocks = await db.userBlock.findMany')) {
  // Find where to inject the blocks fetching logic
  code = code.replace(
    `  const items = rows.map((conversation) => {`,
    `  // Batch fetch block status
  const otherUserIds = rows.map(c => auth.role === 'customer' ? c.expert?.userId : c.customer?.userId).filter(Boolean);
  const blocks = otherUserIds.length ? await db.userBlock.findMany({
    where: {
      OR: [
        { blockerUserId: auth.userId, blockedUserId: { in: otherUserIds } },
        { blockerUserId: { in: otherUserIds }, blockedUserId: auth.userId }
      ]
    }
  }) : [];
  
  const blockMap = {};
  for (const block of blocks) {
    if (block.blockerUserId === auth.userId) {
      blockMap[block.blockedUserId] = { isBlocked: true, blockedByMe: true };
    } else if (block.blockedUserId === auth.userId) {
      blockMap[block.blockerUserId] = { isBlocked: true, blockedByMe: false };
    }
  }

  const items = rows.map((conversation) => {
    const otherUserId = auth.role === 'customer' ? conversation.expert?.userId : conversation.customer?.userId;
    const blockState = blockMap[otherUserId] || { isBlocked: false, blockedByMe: false };
`
  ).replace(
    `    return toConversationSummaryDto(conversation, {
      ...peerInfo(conversation, auth),
      unreadCount,
      lastMessage,
    });`,
    `    return toConversationSummaryDto(conversation, {
      ...peerInfo(conversation, auth),
      unreadCount,
      lastMessage,
      isBlocked: blockState.isBlocked,
      blockedByMe: blockState.blockedByMe,
    });`
  );
  
  fs.writeFileSync(file, code);
  console.log("Patched listConversations");
}
