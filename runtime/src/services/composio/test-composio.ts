/**
 * Interactive integration test for ComposioService.
 *
 * Uses the actual ComposioService — not the raw SDK.
 * Runs step by step with interactive OAuth in the middle.
 * Prints full object shapes so we can see what the API actually returns.
 *
 * Usage:
 *   cd runtime
 *   npx tsx src/services/composio/test-composio.ts
 */

import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ComposioService } from './composioService.js';

// ─── Load .env ────────────────────────────────────────────────────────────────

const envPath = path.resolve(import.meta.dirname, '../../../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim().replace(/^"|"$/g, '');
    if (key) process.env[key] = val;
  }
  console.log('[env] Loaded .env');
}

// ─── Config ───────────────────────────────────────────────────────────────────

const TEST_USER_ID = 'test-user-001';
const TOOLKIT = 'github'; // swap to 'gmail' if you prefer

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(label: string, data: unknown) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[${label}]`);
  console.log(JSON.stringify(data, null, 2));
}

function logArray(label: string, items: unknown[]) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`[${label}] — ${items.length} items, showing first 3:`);
  console.log(JSON.stringify(items.slice(0, 3), null, 2));
}

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(`\n${question} `, (a) => { rl.close(); resolve(a.trim()); }));
}

// ─── Service ──────────────────────────────────────────────────────────────────

const service = new ComposioService();

// ─── Steps ────────────────────────────────────────────────────────────────────

async function step1_listCategories() {
  console.log('\n\n══ STEP 1: service.listCategories() ══');
  const categories = await service.listCategories();
  console.log(`Unique categories: ${categories.length}`);
  console.log(categories);
}

async function step2_listToolkits() {
  console.log('\n\n══ STEP 2: service.listToolkits() — no filter ══');
  const items = await service.listToolkits();
  console.log('Type: ProviderToolkitInfo[]');
  logArray('toolkits', items);
  if (items[0]) log('single toolkit item — full shape', items[0]);
}

async function step3_listToolkitsByCategory() {
  console.log('\n\n══ STEP 3: service.listToolkitsByCategory() ══');
  const result = await service.listToolkitsByCategory();
  const cats = Object.keys(result).sort();
  console.log(`Total categories: ${cats.length}`);
  for (const cat of cats) {
    console.log(`  "${cat}": ${result[cat].length} toolkits`);
  }
  if (cats[0]) {
    log(`toolkits in "${cats[0]}"`, result[cats[0]].map((t: any) => ({ slug: t.slug, name: t.name })));
  }
}

async function step4_listAuthConfigs() {
  console.log(`\n\n══ STEP 4: service.listAuthConfigs("${TOOLKIT}") ══`);
  const result = await service.listAuthConfigs(TOOLKIT);
  log('auth configs response', result);
  console.log(`\nTotal: ${result.items?.length ?? 0}`);
  if (result.items?.length) {
    console.log('First config:', {
      id: result.items[0].id,
      isComposioManaged: result.items[0].isComposioManaged,
      authScheme: result.items[0].authScheme,
    });
  }
}

async function step5_checkExistingConnection() {
  console.log(`\n\n══ STEP 5: service.getConnection({ userId: "${TEST_USER_ID}", toolkitSlug: "${TOOLKIT}" }) ══`);
  const connection = await service.getConnection({ userId: TEST_USER_ID, toolkitSlug: TOOLKIT });
  log('result', connection);
  if (connection) {
    console.log('\nUser already has an active connection:', connection);
  } else {
    console.log('\nNo active connection found.');
  }
  return connection;
}

async function step6_initiateConnection(existing: any) {
  console.log(`\n\n══ STEP 6: service.initiateConnection({ userId: "${TEST_USER_ID}", toolkitSlug: "${TOOLKIT}" }) ══`);

  if (existing) {
    const ans = await prompt('Already connected. Re-initiate anyway? (y/N):');
    if (ans.toLowerCase() !== 'y') {
      console.log('Skipping — using existing connection.');
      return { externalUserId: existing.externalUserId, alreadyConnected: true };
    }
  }

  const req = await service.initiateConnection({ userId: TEST_USER_ID, toolkitSlug: TOOLKIT });
  log('ProviderConnectionRequest full shape', req);

  console.log(`\n${'★'.repeat(60)}`);
  console.log('OPEN THIS URL IN YOUR BROWSER TO AUTHORIZE:');
  console.log(`\n  ${req.redirectUrl}\n`);
  console.log(`${'★'.repeat(60)}`);

  await prompt('Press ENTER after completing authorization in the browser...');
  return { externalUserId: req.externalUserId, alreadyConnected: false };
}

async function step7_waitForConnection(externalUserId: string) {
  console.log(`\n\n══ STEP 7: service.waitForConnection({ externalUserId: "${externalUserId}" }) ══`);
  const connection = await service.waitForConnection({ externalUserId, timeoutMs: 120_000 });
  log('ProviderConnection after wait', connection);
  console.log('\nStatus:', connection.status);
  return connection;
}

async function step8_getToolSchemas(externalUserId: string, authConfigId: string) {
  console.log(`\n\n══ STEP 8: service.getToolSchemas({ externalUserId, authConfigId, limit: 10 }) ══`);
  const schemas = await service.getToolSchemas({ externalUserId, authConfigId, limit: 10 });
  console.log('Schema count:', schemas.length);
  if (schemas.length > 0) {
    console.log('Tool slugs:', schemas.map((t) => t.slug));
    log('First tool schema', schemas[0]);
  } else {
    console.log('No schemas returned — check that connection is ACTIVE.');
  }
}

async function step9_getTools() {
  console.log(`\n\n══ STEP 9: service.getTools({ toolkits: ["${TOOLKIT}"], limit: 5 }) ══`);
  const tools = await service.getTools({ toolkits: [TOOLKIT], limit: 5 });
  const items: any[] = Array.isArray(tools) ? tools : (tools as any)?.items ?? [];
  console.log('Items count:', items.length);
  if (items.length > 0) {
    console.log('Tool slugs:', items.map((t: any) => t.slug ?? t.name));
    log('First tool full schema', items[0]);
  }
}

async function step10_executeTool(externalUserId: string) {
  console.log(`\n\n══ STEP 10: service.executeTool() — read-only call ══`);
  const toolSlug = TOOLKIT === 'github' ? 'GITHUB_GET_THE_AUTHENTICATED_USER' : 'GMAIL_GET_PROFILE';
  console.log(`Calling: ${toolSlug} for user=${TEST_USER_ID}`);
  try {
    const result = await service.executeTool({
      toolSlug,
      userId: TEST_USER_ID,
      externalUserId,
      arguments: {},
    });
    log('executeTool result (ProviderToolResult)', result);
  } catch (err: any) {
    console.error('\nexecuteTool error:', err?.message ?? err);
    log('full error', { message: err?.message, code: err?.code, stack: err?.stack });
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  try {
    await step1_listCategories();
    await step2_listToolkits();
    await step3_listToolkitsByCategory();
    await step4_listAuthConfigs();

    const existing = await step5_checkExistingConnection();
    const { externalUserId, alreadyConnected } = await step6_initiateConnection(existing);

    let authConfigId = existing?.authConfigId ?? '';

    if (!alreadyConnected && externalUserId) {
      const connection = await step7_waitForConnection(externalUserId);
      authConfigId = connection.authConfigId;
    }

    await step8_getToolSchemas(externalUserId, authConfigId);
    await step9_getTools();
    await step10_executeTool(externalUserId);

    console.log('\n\n══ ALL STEPS COMPLETE ══\n');
  } catch (err: any) {
    console.error('\n[FATAL]', err?.message ?? err);
    console.log(JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
    process.exit(1);
  }
}

main();
