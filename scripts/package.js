// Builds a zip of the extension for uploading to the Chrome Web Store and Edge Add-ons.
// Usage: npm run package   ->   dist/pd-notifier-<version>.zip

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extDir = join(root, 'pd-notifier');
const { version } = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));

const distDir = join(root, 'dist');
const zipPath = join(distDir, `pd-notifier-${version}.zip`);

mkdirSync(distDir, { recursive: true });
rmSync(zipPath, { force: true });

// The manifest must be at the root of the zip, so zip from inside the extension directory.
execFileSync('zip', ['-r', '-X', zipPath, '.', '-x', '*.DS_Store'], { cwd: extDir, stdio: 'inherit' });

console.log(`\nCreated ${zipPath}`);
