import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const messagesPath = path.join(__dirname, '../constants/messages.json');
let messages = {};

try {
  const fileContent = fs.readFileSync(messagesPath, 'utf-8');
  messages = JSON.parse(fileContent);
} catch (error) {
  console.error("Failed to load messages.json:", error);
}

export function getMessage(key, params = {}) {
  let message = messages[key] || key;
  
  // Basic interpolation if needed in the future:
  // e.g. "Welcome {name}" -> getMessage("welcome", { name: "John" })
  for (const [paramKey, paramValue] of Object.entries(params)) {
    message = message.replace(`{${paramKey}}`, paramValue);
  }
  
  return message;
}
