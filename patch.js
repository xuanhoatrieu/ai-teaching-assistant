const fs = require('fs');
const file = '/home/trieuhoa/ai-teaching-assistant/backend/src/file-storage/file-storage.controller.ts';
let code = fs.readFileSync(file, 'utf8');
code = code.replace(
  "async serveFile(",
  "async serveFile(\n        @Req() rawReq: any,"
);
code = code.replace(
  "const currentUser = req.user as { userId: string };",
  "console.log('GET FILE:', req.url, 'query token:', req.query?.token ? 'yes' : 'no');\n        const currentUser = req.user as { userId: string };"
);
fs.writeFileSync(file, code);
