const fs = require('fs');
const path = './shared/contracts/support.schema.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  'subject: z.string().min(5).max(200),',
  'subject: z.string().max(200).optional(),\n  referenceId: z.string().max(100).optional(),\n  attachmentId: z.string().uuid().optional(),'
);

fs.writeFileSync(path, content);
