import fs from 'fs';

// 1. Add message key
const msgFile = './shared/constants/messages.json';
let msgs = JSON.parse(fs.readFileSync(msgFile, 'utf8'));
if (!msgs.userBlockedCannotEngage) {
  msgs.userBlockedCannotEngage = "You cannot engage with this user due to a block.";
  fs.writeFileSync(msgFile, JSON.stringify(msgs, null, 2) + '\n');
}

// 2. Patch engagementService.js
const engFile = './services/engagement-service/src/services/engagementService.js';
let code = fs.readFileSync(engFile, 'utf8');

// Patch createQuote
if (!code.includes('userBlockedCannotEngage')) {
  code = code.replace(
    /if \(expert\.userId === auth\.userId\) \{\n\s*throw badRequest\("cannotEngageWithSelf"\);\n\s*\}/,
    `if (expert.userId === auth.userId) {
      throw badRequest("cannotEngageWithSelf");
    }

    const block = await db.userBlock.findFirst({
      where: {
        OR: [
          { blockerUserId: auth.userId, blockedUserId: expert.userId },
          { blockerUserId: expert.userId, blockedUserId: auth.userId },
        ],
      },
    });
    if (block) throw forbidden("userBlockedCannotEngage");`
  );

  // Patch createConsultation
  code = code.replace(
    /if \(expert\.userId === auth\.userId\) \{\n\s*throw badRequest\("cannotEngageWithSelf"\);\n\s*\}/,
    `if (expert.userId === auth.userId) {
    throw badRequest("cannotEngageWithSelf");
  }

  const block = await db.userBlock.findFirst({
    where: {
      OR: [
        { blockerUserId: auth.userId, blockedUserId: expert.userId },
        { blockerUserId: expert.userId, blockedUserId: auth.userId },
      ],
    },
  });
  if (block) throw forbidden("userBlockedCannotEngage");`
  );
  
  fs.writeFileSync(engFile, code);
  console.log("Patched engagementService.js");
}
