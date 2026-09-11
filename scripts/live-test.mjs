import { spawnSync } from 'node:child_process';

if (!process.env.MIMO_API_KEY || !process.env.MIMO_MODEL || !process.env.MIMO_BASE_URL) {
  throw new Error('Configure MIMO_API_KEY, MIMO_MODEL, and MIMO_BASE_URL in .env.local first.');
}
const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '-g', 'LIVE'], {
  stdio: 'inherit', env: { ...process.env, RUN_LIVE_API_TEST: '1' },
});
process.exit(result.status ?? 1);
