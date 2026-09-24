const fs = require('fs');
const file = '/home/jploft-php/Documents/xpertlink/xpertlink-backend/shared/constants/messages.json';
const messages = JSON.parse(fs.readFileSync(file, 'utf8'));

messages.faqsFetched = "FAQs fetched successfully";
messages.faqCreated = "FAQ created successfully";
messages.faqUpdated = "FAQ updated successfully";
messages.faqDeleted = "FAQ deleted successfully";
messages.faqNotFound = "FAQ not found";

fs.writeFileSync(file, JSON.stringify(messages, null, 2));
console.log('Added messages');
