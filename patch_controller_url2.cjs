const fs = require('fs');
const path = 'services/admin-service/src/controllers/supportTickets.controller.js';
let content = fs.readFileSync(path, 'utf8');

// Add import if missing
if (!content.includes('generatePresignedDownloadUrl')) {
  content = content.replace(
    'import { sendEmail } from "@xprtlink/shared/lib/email.js";',
    'import { sendEmail } from "@xprtlink/shared/lib/email.js";\nimport { generatePresignedDownloadUrl } from "@xprtlink/shared/utils/s3.js";'
  );
}

// In list function
content = content.replace(
  `  const formattedItems = items.map(ticket => {
    const profile = ticket.user?.customerProfile || ticket.user?.expertProfile || {};
    const role = ticket.user?.expertProfile ? "expert" : "customer";
    return {
      ...ticket,
      user: {
        id: ticket.user?.id,
        email: ticket.user?.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        role: role
      }
    };
  });`,
  `  const formattedItems = await Promise.all(items.map(async ticket => {
    const profile = ticket.user?.customerProfile || ticket.user?.expertProfile || {};
    const role = ticket.user?.expertProfile ? "expert" : "customer";
    
    let url = null;
    if (ticket.attachment?.storageKey) {
      url = await generatePresignedDownloadUrl(ticket.attachment.storageKey);
    }
    
    const mappedTicket = {
      ...ticket,
      user: {
        id: ticket.user?.id,
        email: ticket.user?.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        role: role
      }
    };
    
    if (ticket.attachment) {
      mappedTicket.attachment = { id: ticket.attachment.id, url };
    }
    
    return mappedTicket;
  }));`
);

// In getById function
content = content.replace(
  `  const profile = ticket.user?.customerProfile || ticket.user?.expertProfile || {};
  const role = ticket.user?.expertProfile ? "expert" : "customer";
  
  return ResponseFormatter.success(res, { 
    data: {
      ...ticket,
      user: {
        id: ticket.user?.id,
        email: ticket.user?.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        role: role
      }
    } 
  });`,
  `  const profile = ticket.user?.customerProfile || ticket.user?.expertProfile || {};
  const role = ticket.user?.expertProfile ? "expert" : "customer";
  
  let url = null;
  if (ticket.attachment?.storageKey) {
    url = await generatePresignedDownloadUrl(ticket.attachment.storageKey);
  }
  
  const mappedTicket = {
    ...ticket,
    user: {
      id: ticket.user?.id,
      email: ticket.user?.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      role: role
    }
  };
  
  if (ticket.attachment) {
    mappedTicket.attachment = { id: ticket.attachment.id, url };
  }
  
  return ResponseFormatter.success(res, { data: mappedTicket });`
);

fs.writeFileSync(path, content);
