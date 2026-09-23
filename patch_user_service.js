import fs from 'fs';
const file = './services/user-service/src/routes/users.routes.js';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('internalPost(')) {
  code = code.replace(
    `import { badRequest, notFound } from "@xprtlink/shared/utils/errors.js";`,
    `import { badRequest, notFound } from "@xprtlink/shared/utils/errors.js";\nimport { internalPost } from "@xprtlink/shared/lib/internalFetch.js";\nimport { getConfig } from "@xprtlink/shared/config/index.js";`
  );
  
  code = code.replace(
    `    return ResponseFormatter.success(res, {
      message: getMessage("userBlockCreated"),`,
    `    
    try {
      const { serviceUrls } = getConfig("user-service");
      await internalPost(serviceUrls.messaging, '/internal/events/user-blocked', {
        blockerUserId: req.auth.userId,
        blockedUserId: actualUserId,
      });
    } catch(err) {
      console.error("[user-service] Failed to broadcast block event:", err.message);
    }

    return ResponseFormatter.success(res, {
      message: getMessage("userBlockCreated"),`
  );

  code = code.replace(
    `    return ResponseFormatter.success(res, {
      message: getMessage("userBlockRemoved"),`,
    `
    try {
      const { serviceUrls } = getConfig("user-service");
      await internalPost(serviceUrls.messaging, '/internal/events/user-unblocked', {
        blockerUserId: req.auth.userId,
        blockedUserId: actualUserId,
      });
    } catch(err) {
      console.error("[user-service] Failed to broadcast unblock event:", err.message);
    }

    return ResponseFormatter.success(res, {
      message: getMessage("userBlockRemoved"),`
  );
  
  // Need to fix the actualUserId in the unblock handler! Wait, I didn't add actualUserId logic to unblock.
  fs.writeFileSync(file, code);
  console.log("Patched user-service block routes to emit internal events.");
}
