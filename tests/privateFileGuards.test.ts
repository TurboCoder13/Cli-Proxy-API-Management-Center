import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('keeps private runtime data out of Git without hiding source or example configuration', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dashboard-private-files-'));
  const privatePaths = [
    '.env',
    '.env.local',
    'config.yaml',
    'config.yml',
    'cliproxyapi.conf',
    'auth.json',
    'auth/account.json',
    'credentials/account.json',
    'management-key',
    'client-key',
    'backups/config.yaml',
    'private/manifest.json',
    'inspection.private.json',
    'inspection.private.yaml',
    'inspection.private.yml',
  ];
  const publicPaths = [
    '.env.example',
    '.env.sample',
    'src/services/api/config.ts',
    'src/features/authFiles/components/AuthFileCard.tsx',
    'tests/fixtures/provider-config.yaml',
    'tests/providerModelOptions.test.ts',
  ];

  try {
    copyFileSync(new URL('../.gitignore', import.meta.url), join(directory, '.gitignore'));
    const initialized = spawnSync('git', ['init', '--quiet'], { cwd: directory });
    expect(initialized.status).toBe(0);

    const checked = spawnSync('git', ['check-ignore', '--no-index', '--stdin', '-z'], {
      cwd: directory,
      input: [...privatePaths, ...publicPaths].join('\0') + '\0',
      encoding: 'utf8',
    });
    expect(checked.status).toBe(0);
    expect(new Set(checked.stdout.split('\0').filter(Boolean))).toEqual(new Set(privatePaths));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
