/**
 * Glob 匹配与路径规范化
 *
 * 功能：
 * - minimatch glob 匹配
 * - 路径规范化（统一为 / 分隔的相对路径）
 * - 路径安全检查（.. 逃逸、绝对路径、NUL 字符、符号链接）
 * - 内置 hard deny 列表
 */

// ========== 内置 Hard Deny 列表（用户不可覆盖） ==========

/**
 * 永久禁止同步的内容。
 * 优先级最高，即使用户在 include 中声明也无法覆盖。
 */
export const BUILTIN_HARD_DENY: readonly string[] = [
	"auth.json",
	"sessions/**",
	"trust.json",
	"models-store.json",
	"npm/**",
	"git/**",
	"node_modules/**",
	"**/node_modules/**",
	".pi-sync/**",
	"**/.env",
	"**/*.pem",
	"**/id_rsa",
	"**/id_ed25519",
];

// ========== 路径规范化 ==========

/**
 * 将任意路径规范化为 POSIX 风格相对路径
 * - 统一分隔符为 /
 * - 去除开头的 ./
 * - 拒绝 NUL 字符
 * - 拒绝 .. 逃逸
 * - 拒绝绝对路径
 */
export function normalizePath(input: string): string {
	if (input.includes("\0")) {
		throw new Error(`Path contains NUL character: ${input}`);
	}

	let normalized = input.replace(/\\/g, "/");

	// 拒绝 POSIX、UNC 和 Windows 盘符绝对路径
	if (normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)) {
		throw new Error(`Absolute path not allowed: ${input}`);
	}

	// 拒绝 .. 逃逸
	const segments = normalized.split("/");
	for (const seg of segments) {
		if (seg === "..") {
			throw new Error(`Path escape not allowed: ${input}`);
		}
	}

	// 去除 ./ 前缀和多余的 /
	normalized = normalized.replace(/^\.\//, "");
	normalized = normalized.replace(/\/+/g, "/");
	normalized = normalized.replace(/\/$/, "");

	return normalized;
}

// ========== Minimatch Glob 匹配 ==========

/**
 * 简易 glob 匹配实现。
 *
 * 支持：
 * - *  匹配任意字符（不包括 /）
 * - ** 匹配任意字符（包括 /）
 * - ?  匹配单个字符（不包括 /）
 * - 不支持字符类 [...]
 */
export function minimatch(str: string, pattern: string): boolean {
	// 确保使用 / 分隔
	const s = str.replace(/\\/g, "/");
	let p = pattern.replace(/\\/g, "/");

	// 如果 pattern 以 / 开头，从开头精确匹配
	if (p.startsWith("/")) {
		p = p.slice(1);
	}

	return minimatchRecursive(s, 0, p, 0);
}

function minimatchRecursive(
	str: string,
	si: number,
	pattern: string,
	pi: number,
): boolean {
	// 都到了末尾
	if (si === str.length && pi === pattern.length) return true;
	// pattern 结束但字符串还有内容
	if (pi === pattern.length) return false;
	// 字符串结束但 pattern 还有内容，剩余必须全是 *
	if (si === str.length) {
		while (pi < pattern.length) {
			if (pattern[pi] === "*") {
				pi++;
				if (pi < pattern.length && pattern[pi] === "*") pi++;
			} else {
				return false;
			}
		}
		return true;
	}

	const pc = pattern[pi]!;

	// ** 匹配任意内容（包括 /）
	if (pi + 1 < pattern.length && pc === "*" && pattern[pi + 1] === "*") {
		let nextPi = pi + 2;
		if (nextPi < pattern.length && pattern[nextPi] === "/") nextPi++;

		for (let i = si; i <= str.length; i++) {
			if (minimatchRecursive(str, i, pattern, nextPi)) return true;
		}
		return false;
	}

	// * 匹配任意字符（不包括 /）
	if (pc === "*") {
		for (let i = si; i <= str.length; i++) {
			if (i > si && str[i - 1] === "/") break;
			if (minimatchRecursive(str, i, pattern, pi + 1)) return true;
		}
		return false;
	}

	// ? 匹配单个字符（但不能是 /）
	if (pc === "?") {
		if (str[si] === "/") return false;
		return minimatchRecursive(str, si + 1, pattern, pi + 1);
	}

	// 普通字符：精确匹配
	if (str[si] === pc) {
		return minimatchRecursive(str, si + 1, pattern, pi + 1);
	}

	return false;
}

// ========== 白名单文件判定 ==========

/**
 * 检查文件路径是否在白名单内。
 *
 * 优先级（从高到低）：
 *   内置 hard deny > manifest exclude > manifest include
 *
 * @returns { allowed: boolean, denied: boolean, reason?: string }
 */
export function isPathAllowed(
	relativePath: string,
	include: string[],
	exclude: string[],
): { allowed: boolean; denied: boolean; reason?: string } {
	const normalized = normalizePath(relativePath);

	// 1. 内置 hard deny（最高优先级）
	for (const pattern of BUILTIN_HARD_DENY) {
		if (minimatch(normalized, pattern)) {
			return {
				allowed: false,
				denied: true,
				reason: `Built-in deny: ${pattern}`,
			};
		}
	}

	// 2. 检查 include 白名单
	let inInclude = false;
	for (const pattern of include) {
		if (minimatch(normalized, pattern)) {
			inInclude = true;
			break;
		}
	}

	if (!inInclude) {
		return { allowed: false, denied: false, reason: "Not in include patterns" };
	}

	// 3. 检查 exclude 列表
	for (const pattern of exclude) {
		if (minimatch(normalized, pattern)) {
			return {
				allowed: false,
				denied: false,
				reason: `Excluded by: ${pattern}`,
			};
		}
	}

	return { allowed: true, denied: false };
}

/**
 * 批量检查文件是否允许同步
 */
export function filterAllowedFiles(
	paths: string[],
	include: string[],
	exclude: string[],
): { allowed: string[]; denied: string[] } {
	const allowed: string[] = [];
	const denied: string[] = [];

	for (const p of paths) {
		const result = isPathAllowed(p, include, exclude);
		if (result.allowed) {
			allowed.push(p);
		} else if (result.denied) {
			denied.push(p);
		}
		// 不在 include 中也不属于 deny 的文件静默忽略
	}

	return { allowed, denied };
}
