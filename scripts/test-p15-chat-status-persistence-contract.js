#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const schema = fs.readFileSync(path.join(process.cwd(), 'src/lib/db/schema.ts'), 'utf8');
const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/chat/route.ts'), 'utf8');
const chatRoute = fs.readFileSync(path.join(process.cwd(), 'src/app/api/chats/[id]/route.ts'), 'utf8');

const checks = {
  schemaHasStatusRole: /enum: \[['\"]assistant['\"], ['\"]user['\"], ['\"]source['\"], ['\"]status['\"]\]/.test(schema),
  routePersistsStatus: /role: 'status'/.test(route),
  routeBuffersStatuses: /const persistedStatuses: string\[\] = \[\]/.test(route),
  routeFlushesStatusesOnEnd: /persistStatusMessages\(/.test(route),
  chatDetailReturnsStatusMessages: /findMany\([\s\S]*orderBy/.test(chatRoute) && /messages: chatMessages/.test(chatRoute),
};

console.table(checks);

const failed = Object.entries(checks).filter(([,v]) => !v).map(([k]) => k);
if (failed.length) {
  console.error(`\nP1.5 chat status persistence contract failed: ${failed.join(', ')}`);
  process.exit(1);
}

console.log('\nP1.5 chat status persistence contract checks passed.');
