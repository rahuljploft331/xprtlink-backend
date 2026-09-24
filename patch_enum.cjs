const fs = require('fs');
const schemaPath = 'shared/prisma/schema.prisma';
let schema = fs.readFileSync(schemaPath, 'utf8');

schema = schema.replace(
  'verification_doc\n  banner',
  'verification_doc\n  banner\n  support_attachment'
);

fs.writeFileSync(schemaPath, schema);
