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
  const hasKey = Object.prototype.hasOwnProperty.call(messages, key);

  // Self-enforce the SSOT: outside production, surface any key that isn't
  // defined in messages.json (or any raw prose string passed instead of a key)
  // so it can't silently slip through via the fallback below.
  if (!hasKey && process.env.NODE_ENV !== "production") {
    console.warn(
      `[messages] Unknown message key "${key}" — add it to shared/constants/messages.json ` +
      `(never pass a raw prose string to getMessage/error helpers).`
    );
  }

  let message = hasKey ? messages[key] : key;

  // Interpolate {placeholder} tokens, e.g. getMessage("welcome", { name: "John" })
  for (const [paramKey, paramValue] of Object.entries(params)) {
    message = message.replace(`{${paramKey}}`, paramValue);
  }

  return message;
}
