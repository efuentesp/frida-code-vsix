/**
 * 安全模块：内置 hard deny 和 secret scanning
 *
 * 内置 hard deny 优先级最高，用户无法通过 include 覆盖。
 * Secret scan 在 push 前扫描完整文件和 staged diff。
 */
import { minimatch, BUILTIN_HARD_DENY } from "../sync/glob";

// ========== Secret 检测模式 ==========

const SECRET_PATTERNS: Array<{ name: string; pattern: RegExp; requiresContext?: RegExp }> = [
  {
    name: "GitHub Token",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/,
  },
  {
    name: "OpenAI API Key",
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/,
  },
  {
    name: "Anthropic API Key",
    pattern: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/,
  },
  {
    name: "AWS Access Key",
    pattern: /AKIA[0-9A-Z]{16}/,
  },
  {
    name: "AWS Secret Key",
    pattern: /(?<![A-Za-z0-9\/+=])[A-Za-z0-9\/+=]{40}(?![A-Za-z0-9\/+=])/,
    requiresContext: /aws|amazon|secret.?key|secret.?access/i,
  },
  {
    name: "Generic API Key",
    pattern: /(?:\bapi[_-]?key\b|\bapikey\b|\bsecret[_-]?key\b)\s*[:=]\s*['"]?[A-Za-z0-9_\-.]{20,}['"]?/i,
  },
  {
    name: "JWT Token",
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  },
  {
    name: "Private Key",
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/,
  },
];

// ========== Hard Deny ==========

/**
 * 检查文件路径是否被内置 hard deny 阻止。
 * 同时检查用户提供的额外 deny 模式（虽然 schema v2 中用户不可配置 deny，
 * 但保留参数以兼容可能的未来扩展）。
 */
export function isDenied(path: string, extraDenyPatterns: string[] = []): boolean {
  const normalized = path.replace(/\\/g, "/");

  // 内置 hard deny（优先级最高）
  for (const pattern of BUILTIN_HARD_DENY) {
    if (minimatch(normalized, pattern)) {
      return true;
    }
  }

  // 额外 deny 模式
  for (const pattern of extraDenyPatterns) {
    if (minimatch(normalized, pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * 从路径列表中找出被拒绝的文件
 */
export function findDeniedFiles(paths: string[]): string[] {
  return paths.filter((p) => isDenied(p));
}

// ========== Secret Scan ==========

/**
 * 扫描内容中的秘密信息
 */
export function scanSecrets(
  content: string,
  filePath: string,
): Array<{ type: string; file: string; line?: number }> {
  const findings: Array<{ type: string; file: string; line?: number }> = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const secret of SECRET_PATTERNS) {
      if (!secret.pattern.test(line)) continue;
      // 如果有上下文要求，检查整个内容
      if (secret.requiresContext && !secret.requiresContext.test(content)) continue;
      findings.push({
        type: secret.name,
        file: filePath,
        line: i + 1,
      });
    }
  }

  return findings;
}

/**
 * 批量扫描多个文件中的秘密
 */
export function scanFilesForSecrets(
  files: Array<{ path: string; content: string }>,
): Array<{ type: string; file: string; line?: number }> {
  const results: Array<{ type: string; file: string; line?: number }> = [];
  for (const file of files) {
    results.push(...scanSecrets(file.content, file.path));
  }
  return results;
}
