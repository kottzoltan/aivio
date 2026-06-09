import path from "path";
import { fileURLToPath } from "url";

/** Netlify esbuild bundle (CJS) has no import.meta.url — safe dirname for all runtimes. */
export function getModuleDir() {
  try {
    if (import.meta?.url) {
      return path.dirname(fileURLToPath(import.meta.url));
    }
  } catch {
    // ignore
  }
  if (typeof __dirname !== "undefined") return __dirname;
  return process.cwd();
}

export function getProjectRoot() {
  const dir = getModuleDir();
  if (dir.endsWith(`${path.sep}lib`)) return path.dirname(dir);
  if (dir.includes(`${path.sep}netlify${path.sep}functions`)) return process.cwd();
  return dir;
}

export function isDirectNodeEntry(metaUrl, argvPath) {
  try {
    if (!metaUrl || !argvPath) return false;
    return fileURLToPath(metaUrl) === path.resolve(argvPath);
  } catch {
    return false;
  }
}
