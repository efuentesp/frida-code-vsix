/**
 * 文件内容校验
 *
 * 在 apply 前校验：
 * - JSON 格式正确
 * - 不含 Git 冲突标记 (<<<<<<<, =======, >>>>>>>)
 * - settings.json 的可移植性
 * - Skill/Theme/Prompt 基本格式
 */
import { readFile } from "node:fs/promises";
import type { PiSyncConfig } from "./config";
import { normalizePath } from "./glob";
import { resolveRepoSyncRoot, resolveWithinRoot } from "../system/path-safety";

// ========== 校验结果 ==========

export interface ValidationError {
  file: string;
  message: string;
  severity: "error" | "warning";
}

export interface ValidationResult {
  errors: ValidationError[];
  /** 是否有阻断性错误 */
  blocked: boolean;
}

// ========== 冲突标记检测 ==========

const CONFLICT_PATTERNS = [/^<<<<<<</m, /^>>>>>>>/m, /^=======/m];

/**
 * 检查文件内容是否包含 Git 冲突标记
 */
export function hasConflictMarkers(content: string): boolean {
  return CONFLICT_PATTERNS.some((p) => p.test(content));
}

// ========== JSON 校验 ==========

/**
 * 校验 JSON 文件格式
 */
export function validateJson(
  filePath: string,
  content: string,
): ValidationError[] {
  const errors: ValidationError[] = [];
  try {
    JSON.parse(content);
  } catch (err) {
    errors.push({
      file: filePath,
      message: `Invalid JSON: ${err instanceof Error ? err.message : "Unknown error"}`,
      severity: "error",
    });
  }
  return errors;
}

// ========== Settings.json 可移植性检查 ==========

/**
 * 检查 settings.json 的可移植性问题
 */
export function validateSettingsPortability(
  content: string,
): ValidationError[] {
  const errors: ValidationError[] = [];

  try {
    const settings = JSON.parse(content);

    // 检查 packages 中的绝对路径
    const packages = settings.packages;
    if (Array.isArray(packages)) {
      for (const pkg of packages) {
        if (typeof pkg !== "string") continue;
        if (pkg.startsWith("/") || pkg.startsWith("~/")) {
          errors.push({
            file: "settings.json",
            message: `Absolute package path: ${pkg}. Use portable sources like "npm:..." or "git:...".`,
            severity: "error",
          });
        }
        // 检查是否以本地路径开头（不以 npm:, git:, https://, ssh://, 或 @scope 开头）
        if (
          !pkg.startsWith("npm:") &&
          !pkg.startsWith("git:") &&
          !pkg.startsWith("https://") &&
          !pkg.startsWith("ssh://") &&
          !pkg.startsWith("@") &&
          (pkg.startsWith(".") || pkg.startsWith("/") || pkg.startsWith("~"))
        ) {
          errors.push({
            file: "settings.json",
            message: `Potentially non-portable package: ${pkg}`,
            severity: "warning",
          });
        }
      }

    }

    // 检查可疑的 home 目录或设备专属路径
    const contentStr = JSON.stringify(settings);
    if (/\/home\/|\/Users\//.test(contentStr)) {
      errors.push({
        file: "settings.json",
        message: "Contains paths that look machine-specific (/home/ or /Users/). These may not work on other devices.",
        severity: "warning",
      });
    }

    // 检查 externalEditor 是否为绝对路径
    if (typeof settings.externalEditor === "string" && settings.externalEditor.startsWith("/")) {
      errors.push({
        file: "settings.json",
        message: "externalEditor is an absolute path, which may not exist on other machines.",
        severity: "warning",
      });
    }
  } catch {
    // JSON 解析错误已在 validateJson 中处理
  }

  return errors;
}

// ========== 综合校验 ==========

/**
 * 对一组文件运行所有校验
 *
 * @param repoPath 仓库路径
 * @param config 同步配置
 * @param files 需要校验的相对路径列表
 */
export async function validateFiles(
  repoPath: string,
  config: PiSyncConfig,
  files: string[],
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const safeRoot = await resolveRepoSyncRoot(repoPath, config.root, "read");

  for (const relPath of files) {
    let normalizedPath: string;
    try {
      normalizedPath = normalizePath(relPath);
      if (normalizedPath === "") throw new Error("Empty path");
    } catch {
      errors.push({
        file: relPath,
        message: "File path must be a non-empty relative path within the sync root.",
        severity: "error",
      });
      continue;
    }

    const fullPath = await resolveWithinRoot(safeRoot, normalizedPath, "read");

    let content: string;
    try {
      content = await readFile(fullPath, "utf-8");
    } catch {
      // 文件不存在（可能是计划删除的），跳过
      continue;
    }

    // 冲突标记检查（所有文件）
    if (hasConflictMarkers(content)) {
      errors.push({
        file: normalizedPath,
        message: "File contains Git conflict markers (<<<<<<<, =======, >>>>>>>). Resolve conflicts before syncing.",
        severity: "error",
      });
    }

    // JSON 文件：格式检查
    if (normalizedPath.endsWith(".json")) {
      errors.push(...validateJson(normalizedPath, content));
    }

    // settings.json：可移植性
    if (normalizedPath === "settings.json") {
      errors.push(...validateSettingsPortability(content));
    }
  }

  const hasBlockingErrors = errors.some((e) => e.severity === "error");

  return { errors, blocked: hasBlockingErrors };
}
