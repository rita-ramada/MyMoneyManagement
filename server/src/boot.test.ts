import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { bootOptions } from './boot';

test('defaults: data and client dist relative to the repo, port 4321, no browser', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmm-root-'));
  try {
    const here = path.join(root, 'server', 'src');
    fs.mkdirSync(path.join(root, 'client', 'dist'), { recursive: true });
    expect(bootOptions({}, here)).toEqual({
      dataDir: path.join(root, 'data'), port: 4321, clientDistDir: path.join(root, 'client', 'dist'), openBrowser: false,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('env overrides; clientDistDir omitted when the client is not built', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mmm-root-'));
  try {
    const opts = bootOptions({ DATA_DIR: path.join(root, 'x'), PORT: '5000', OPEN_BROWSER: '1' }, path.join(root, 'server', 'src'));
    expect(opts).toEqual({ dataDir: path.join(root, 'x'), port: 5000, clientDistDir: undefined, openBrowser: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
