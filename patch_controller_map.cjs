const fs = require('fs');
const path = 'services/admin-service/src/controllers/supportTickets.controller.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  `  return ResponseFormatter.success(res, {
    data: items,
    meta: { total, page: Number(page), limit: Number(limit) }
  });`,
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
  });

  return ResponseFormatter.success(res, {
    data: formattedItems,
    meta: { total, page: Number(page), limit: Number(limit) }
  });`
);

content = content.replace(
  `  return ResponseFormatter.success(res, { data: ticket });`,
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
  });`
);

fs.writeFileSync(path, content);
