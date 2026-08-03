import { lstat, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { normalizePath } from "../sync/glob";

export type PathIntent = "read" | "write" | "delete" | "backup" | "restore";

export interface SafeRoot {
  path: string;
  realPath: string;
}

function ensureRelativePath(value: string, label: string): string {
  const normalized = normalizePath(value);
  if (normalized === "" || isAbsolute(normalized)) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  return normalized;
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Reject symlinks at the trusted root and in every existing relative component.
 * System path prefixes (for example macOS /var -> /private/var) are not part of
 * the trusted root and are intentionally not treated as an escape.
 */
export async function assertNoSymlinkComponents(
  root: string,
  relativePath = "",
): Promise<void> {
  const absoluteRoot = resolve(root);
  const normalizedRelative = relativePath ? normalizePath(relativePath) : "";
  const target = normalizedRelative ? resolve(absoluteRoot, normalizedRelative) : absoluteRoot;
  if (!isWithin(absoluteRoot, target)) {
    throw new Error(`Path escapes trusted root: ${relativePath}`);
  }

  const components = [
    absoluteRoot,
    ...normalizedRelative.split("/").filter(Boolean),
  ];
  let current = absoluteRoot;
  for (let index = 0; index < components.length; index++) {
    current = index === 0 ? absoluteRoot : resolve(current, components[index]!);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw new Error(`Refusing to follow symbolic link for ${relativePath || root}: ${current}`);
      }
      if (index < components.length - 1 && !info.isDirectory()) {
        throw new Error(`Path component is not a directory: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // A missing leaf and its future descendants are safe only below the
      // nearest existing parent, which was checked before this point.
      let parent = dirname(current);
      while (parent !== dirname(parent)) {
        try {
          const parentInfo = await lstat(parent);
          if (parentInfo.isSymbolicLink()) {
            throw new Error(`Refusing to create below symbolic link: ${parent}`);
          }
          break;
        } catch (parentError) {
          if ((parentError as NodeJS.ErrnoException).code !== "ENOENT") throw parentError;
          parent = dirname(parent);
        }
      }
      break;
    }
  }
}

/** Resolve and validate the repository sync root. */
export async function resolveRepoSyncRoot(
  repoPath: string,
  root: string,
  intent: PathIntent,
): Promise<SafeRoot> {
  const normalizedRoot = ensureRelativePath(root, "sync root");
  const trustedRepo = resolve(repoPath);
  await assertNoSymlinkComponents(trustedRepo);
  const syncRoot = resolve(trustedRepo, normalizedRoot);
  if (!isWithin(trustedRepo, syncRoot)) {
    throw new Error(`Sync root escapes repository: ${root}`);
  }
  await assertNoSymlinkComponents(trustedRepo, normalizedRoot);

  if (existsSync(syncRoot)) {
    const info = await lstat(syncRoot);
    if (!info.isDirectory()) {
      throw new Error(`Sync root is not a directory (${intent}): ${syncRoot}`);
    }
    const resolved = await realpath(syncRoot);
    const repoReal = await realpath(trustedRepo);
    if (!isWithin(repoReal, resolved)) {
      throw new Error(`Sync root resolves outside repository: ${syncRoot}`);
    }
    return { path: syncRoot, realPath: resolved };
  }

  // The root may be created later, but its existing parent must be trusted.
  await assertNoSymlinkComponents(dirname(syncRoot));
  return {
    path: syncRoot,
    realPath: resolve(await realpath(trustedRepo), normalizedRoot),
  };
}

/** Resolve a relative path below a trusted root without following symlinks. */
export async function resolveWithinRoot(
  root: string | SafeRoot,
  relativePath: string,
  intent: PathIntent,
): Promise<string> {
  const rootPath = typeof root === "string" ? resolve(root) : root.path;
  const normalized = ensureRelativePath(relativePath, "relative path");
  const candidate = resolve(rootPath, normalized);
  if (!isWithin(rootPath, candidate)) {
    throw new Error(`Path escapes trusted root (${intent}): ${relativePath}`);
  }

  await assertNoSymlinkComponents(rootPath, normalized);
  if (existsSync(candidate)) {
    const trustedReal = typeof root === "string"
      ? await realpath(rootPath)
      : root.realPath;
    const candidateReal = await realpath(candidate);
    if (!isWithin(trustedReal, candidateReal)) {
      throw new Error(`Path resolves outside trusted root (${intent}): ${relativePath}`);
    }
  }
  return candidate;
}
