import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export type StoredAsset = { filename: string; sha256: string; mediaId?: string };
export function projectScope(url: string): string | null {
  try {
    const u = new URL(url);
    if (!['flow.google.com', 'labs.google'].includes(u.hostname)) return null;
    return u.pathname.match(/\/(?:fx\/tools\/flow\/)?project\/([\w-]+)/)?.[1] ?? null;
  } catch { return null; }
}
export function assetCachePath(): string {
  const profile = process.env.CHROME_USER_DATA_DIR || path.join(os.homedir(), '.config', 'mcp-flow-google', 'chrome_profile');
  return process.env.FLOW_ASSET_CACHE_PATH || path.join(profile.replace(/^~/, os.homedir()), 'flow-materials.json');
}
type Registry = { version: 1; projects: Record<string, Record<string, StoredAsset>> };
function readRegistry(): Registry {
  if (!fs.existsSync(assetCachePath())) return { version: 1, projects: {} };
  const data = JSON.parse(fs.readFileSync(assetCachePath(), 'utf8'));
  if (data.version !== 1 || !data.projects) throw new Error('Invalid Flow material registry');
  return data;
}
export function storedAsset(project: string, sha256: string): StoredAsset | undefined {
  return readRegistry().projects[project]?.[sha256];
}
export function rememberAsset(project: string, asset: StoredAsset): void {
  const data = readRegistry();
  (data.projects[project] ??= {})[asset.sha256] = asset;
  const file = assetCachePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temporary, file);
}
