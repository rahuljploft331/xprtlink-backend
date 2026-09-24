const fs = require('fs');
const schemaPath = 'shared/contracts/media.schema.js';
let content = fs.readFileSync(schemaPath, 'utf8');

content = content.replace(
  /"verification_doc",\n    "banner",/g,
  '"verification_doc",\n    "banner",\n    "support_attachment",'
);

fs.writeFileSync(schemaPath, content);
