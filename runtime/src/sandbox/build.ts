#!/usr/bin/env node

/// <reference types="node" />

/**
 * Build all sandbox runtime Docker images
 * This script should be run once before starting the runtime
 *
 * Usage: node build.ts (or npm run build:sandbox)
 */

import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync, statSync, existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const RUNTIME_DIR = resolve(__dirname, '../../..');
const SANDBOX_DIR = resolve(__dirname, 'runtimes');

function discoverRuntimes() {
  const runtimes: Array<{ name: string; tag: string }> = [];

  const entries = readdirSync(SANDBOX_DIR);
  for (const entry of entries) {
    const entryPath = resolve(SANDBOX_DIR, entry);
    const dockerfilePath = resolve(entryPath, 'Dockerfile');

    if (statSync(entryPath).isDirectory() && existsSync(dockerfilePath)) {
      runtimes.push({
        name: entry,
        tag: `${entry}-runtime:latest`,
      });
    }
  }

  return runtimes;
}

function exec(command: string, description: string) {
  console.log(`📦 ${description}...`);
  try {
    execSync(command, {
      cwd: RUNTIME_DIR,
      stdio: 'inherit',
    });
    console.log('✅ Done\n');
  } catch (error) {
    console.error(`❌ Failed: ${description}`);
    throw error;
  }
}

function checkPodman() {
  try {
    execSync('podman --version', { stdio: 'ignore' });
  } catch {
    console.error('❌ Error: podman is not installed');
    console.error('Install podman: https://podman.io/getting-started/installation');
    process.exit(1);
  }
}

async function main() {
  console.log('🏗️  Building sandbox runtime images...\n');

  checkPodman();

  const runtimes = discoverRuntimes();

  if (runtimes.length === 0) {
    console.log('⚠️  No runtimes found in', SANDBOX_DIR);
    return;
  }

  console.log(`Found ${runtimes.length} runtime(s): ${runtimes.map((r) => r.name).join(', ')}\n`);

  for (const runtime of runtimes) {
    const dockerfilePath = resolve(SANDBOX_DIR, runtime.name, 'Dockerfile');
    exec(`podman build -f "${dockerfilePath}" -t ${runtime.tag} .`, `Building ${runtime.tag}`);
  }

  console.log('🎉 All sandbox runtime images built successfully!\n');
  console.log('Images:');

  try {
    execSync('podman images | grep "runtime:latest"', {
      stdio: 'inherit',
      shell: '/bin/bash',
    });
  } catch {
    console.log('No runtime images found');
  }
}

main().catch((error) => {
  console.error('Build failed:', error.message);
  process.exit(1);
});
