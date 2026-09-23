import fs from 'fs';
const file = './services/messaging-service/src/sockets/messagingSocket.js';
let code = fs.readFileSync(file, 'utf8');

if (!code.includes('export function getIo()')) {
  code = code.replace(
    'export function registerMessagingSockets(io) {',
    `let _io = null;\nexport function getIo() { return _io; }\n\nexport function registerMessagingSockets(io) {\n  _io = io;`
  );
  fs.writeFileSync(file, code);
  console.log("Patched messagingSocket.js");
}
