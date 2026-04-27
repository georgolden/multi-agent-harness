import path from 'node:path';
import os from 'node:os';

export const SANDBOX_REALM_ROOT = path.join(os.homedir(), '.agi/sandbox-realm');
