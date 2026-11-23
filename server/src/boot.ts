import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface BootOptions {
  dataDir: string;
  port: number;
  /** Only set when the client has been built. */
  clientDistDir: string | undefined;
  openBrowser: boolean;
}

/** `here` is the directory of the server entry file (server/src). */
export function bootOptions(env: Record<string, string | undefined>, here: string): BootOptions {
  const root = path.resolve(here, '../..');
  const dist = path.join(root, 'client', 'dist');
  return {
    dataDir: env.DATA_DIR ? path.resolve(env.DATA_DIR) : path.join(root, 'data'),
    port: Number(env.PORT ?? 4321),
    clientDistDir: fs.existsSync(dist) ? dist : undefined,
    openBrowser: env.OPEN_BROWSER === '1',
  };
}

/** Opens the default browser once the server is listening (Windows, macOS, Linux). */
export function openInBrowser(url: string): void {
  const [cmd, args] = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
}
