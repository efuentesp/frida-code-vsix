/**
 * Flujos del comando `frida.worktree` — porte de @narumitw/pi-worktree/command.ts.
 *
 * Conserva TODO el estado/orquestación/seguridad del original (revalidación
 * post-confirmación TOCTOU, inventario protected/ignored, detached-HEAD durable,
 * recovery history administrativa). La UX (input/confirm/notify/select/menu,
 * basada en @narumitw/pi-tui-kit) se reemplazó por APIs de VS Code
 * (showInputBox / showWarningMessage modal / showQuickPick). "Switch" abre el
 * worktree en una **ventana VS Code nueva** (cwd + sesión propios), dado que
 * Frida fija el cwd de la sesión al workspace (issue #13).
 *
 * Refs #13.
 */
import * as vscode from "vscode";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { GitClient } from "./exec";
import {
	addWorktree,
	administrativeHistoryOids,
	administrativePruneCandidates,
	currentWorktreePath,
	defaultWorktreePath,
	durableRefExists,
	durableRefsContaining,
	formatWorktree,
	listWorktrees,
	localBranchExists,
	pathEntryExists,
	pathIdentity,
	pathsEqual,
	prunePreview,
	pruneWorktrees,
	removeWorktree,
	resolveCommit,
	sameWorktreeIdentity,
	stripTerminalControls,
	symbolicBranch,
	unresolvableSymlinkAncestor,
	validateBranch,
	worktreeAdministrativeDirectory,
	worktreeForBranch,
	worktreeInventory,
	type WorktreeRecord,
} from "./git";
import type { WorktreeSettingsRuntime } from "./settings";

type Action = "add" | "switch" | "remove" | "prune" | "configure";

interface FlowCtx {
	git: GitClient;
	cwd: string;
	signal: AbortSignal;
}

interface AdministrativeHistoryRisk {
	label: string;
	oids: string[];
}

interface RemovalInventory {
	ignored: string[];
	protected: string[];
}

// ============================ UI (VS Code) ============================

async function uiInput(prompt: string, value = ""): Promise<string | undefined> {
	return vscode.window.showInputBox({ prompt, value });
}

async function uiConfirm(title: string, message: string): Promise<boolean> {
	const picked = await vscode.window.showWarningMessage(
		`${title}\n\n${stripTerminalControls(message)}`,
		{ modal: true },
		"Confirmar",
		"Cancelar",
	);
	return picked === "Confirmar";
}

function uiNotify(message: string, level: "info" | "warning" | "error"): void {
	const clean = stripTerminalControls(message);
	if (level === "error") void vscode.window.showErrorMessage(clean);
	else if (level === "warning") void vscode.window.showWarningMessage(clean);
	else void vscode.window.showInformationMessage(clean);
}

async function selectWorktree(
	title: string,
	records: readonly WorktreeRecord[],
	currentPath: string,
	signal?: AbortSignal,
): Promise<WorktreeRecord | undefined> {
	if (records.length === 0) {
		uiNotify("No hay worktrees elegibles para esta acción.", "info");
		return undefined;
	}
	if (signal?.aborted) return undefined;
	const items: Array<vscode.QuickPickItem & { record: WorktreeRecord }> = records.map(
		(record, index) => ({
			label: `${index + 1}. ${formatWorktree(record, currentPath)}`,
			record,
		}),
	);
	const picked = await vscode.window.showQuickPick(items, {
		title,
		placeHolder: "Selecciona un worktree",
	});
	return picked?.record;
}

async function openWorktreeInNewWindow(path: string): Promise<void> {
	await vscode.commands.executeCommand(
		"vscode.openFolder",
		vscode.Uri.file(path),
		{ forceNewWindow: true },
	);
}

async function pickAction(
	recordCount: number,
	currentPath: string,
	effectiveRoot: string,
	source: string,
	warning?: string,
): Promise<Action | undefined> {
	const items: Array<vscode.QuickPickItem & { action: Action }> = [
		{ label: "$(git-branch) Add worktree", description: "crear worktree nuevo o conectar rama", action: "add" },
		{ label: "$(folder-opened) Abrir worktree", description: "abrir uno existente en ventana nueva", action: "switch" },
		{ label: "$(trash) Remove worktree", description: "eliminar (conserva la rama)", action: "remove" },
		{ label: "$(clear-all) Prune", description: "limpiar metadatos obsoletos", action: "prune" },
		{ label: "$(settings-gear) Configure root", description: "raíz por defecto de worktrees", action: "configure" },
	];
	const suffix = warning ? " — settings warning" : "";
	const picked = await vscode.window.showQuickPick(items, {
		title: `Git worktrees · ${recordCount} registrados · root: ${effectiveRoot} (${source})${suffix}`,
		placeHolder: `Actual: ${currentPath}`,
	});
	return picked?.action;
}

// ============================ Entry ============================

export async function runWorktreeFlows(
	git: GitClient,
	settings: WorktreeSettingsRuntime,
	cwd: string,
): Promise<void> {
	const controller = new AbortController();
	const signal = controller.signal;
	try {
		const records = await listWorktrees(git, cwd, signal);
		const currentPath = await currentWorktreePath(git, cwd, signal);
		const root = settings.get();
		const action = await pickAction(
			records.length,
			currentPath,
			root.effectiveRoot,
			root.source,
			root.warning,
		);
		if (!action) return;
		const fc: FlowCtx = { git, cwd, signal };
		try {
			switch (action) {
				case "add":
					await addFlow(fc, records, root.effectiveRoot);
					break;
				case "switch":
					await openFlow(fc, records, currentPath);
					break;
				case "remove":
					await removeFlow(fc, records, currentPath);
					break;
				case "prune":
					await pruneFlow(fc, records);
					break;
				case "configure":
					await configureRootFlow(settings);
					break;
			}
		} catch (error) {
			uiNotify(formatError(error), "error");
		}
	} catch (error) {
		uiNotify(formatError(error), "error");
	}
}

// ============================ Flows ============================

async function configureRootFlow(settings: WorktreeSettingsRuntime): Promise<void> {
	const current = await settings.reload();
	if (!current.canSave) {
		throw new Error(
			current.warning ?? `Arregla ${settings.getPath()} antes de cambiar la config de worktrees.`,
		);
	}
	const requested = await uiInput(
		"Worktree root (vacío restaura ~/.worktrees)",
		current.configuredRoot ?? current.effectiveRoot,
	);
	if (requested === undefined) return;
	const configuredRoot = requested.trim() || undefined;
	const updated = await settings.save(configuredRoot);
	uiNotify(
		configuredRoot === undefined
			? `Worktree root restaurado a ${updated.effectiveRoot}.`
			: `Worktree root guardado como ${updated.effectiveRoot}.`,
		"info",
	);
}

async function addFlow(
	fc: FlowCtx,
	records: readonly WorktreeRecord[],
	worktreeRoot: string,
): Promise<void> {
	const { git, cwd, signal } = fc;
	const main = records[0];
	if (!main) throw new Error("Git no devolvió worktrees registrados.");
	if (main.bare) {
		throw new Error("El worktree principal es bare; no se puede derivar un path seguro.");
	}
	if (!existsSync(main.path)) {
		throw new Error(`El path del worktree principal está obsoleto: ${main.path}. Repáralo con Git.`);
	}

	const requestedBranch = await uiInput("Rama para el nuevo worktree", "feat/mi-cambio");
	if (requestedBranch === undefined) return;
	const branchInput = requestedBranch.trim();
	if (!branchInput) throw new Error("El nombre de la rama es obligatorio.");
	const branch = await validateBranch(git, cwd, branchInput, signal);
	const branchExists = await localBranchExists(git, cwd, branch, signal);
	const occupied = worktreeForBranch(records, branch);
	if (occupied) {
		throw new Error(`La rama ${branch} ya está checked out en ${occupied.path}.`);
	}

	let startOid: string | undefined;
	let startLabel: string | undefined;
	if (!branchExists) {
		const defaultStart = await symbolicBranch(git, cwd, signal);
		const requestedStart = await uiInput(
			defaultStart
				? `Punto de inicio para ${branch} (vacío usa ${defaultStart})`
				: `Punto de inicio para ${branch} (obligatorio: HEAD está detached)`,
			defaultStart ?? "commit-ish",
		);
		if (requestedStart === undefined) return;
		startLabel = requestedStart.trim() || defaultStart;
		if (!startLabel) throw new Error("Se requiere un punto de inicio explícito desde HEAD detached.");
		startOid = await resolveCommit(git, cwd, startLabel, signal);
	}

	const suggestedPath = defaultWorktreePath(main.path, branch, worktreeRoot);
	const requestedPath = await uiInput(`Path del worktree (vacío usa ${suggestedPath})`, suggestedPath);
	if (requestedPath === undefined) return;
	const targetPath = pathIdentity(
		requestedPath.trim() ? resolve(cwd, requestedPath.trim()) : suggestedPath,
	);
	assertTargetFilesystemAvailable(targetPath);
	const pathCollision = records.find((record) => pathsEqual(record.path, targetPath));
	if (pathCollision) {
		throw new Error(`El path ya está registrado como worktree: ${pathCollision.path}.`);
	}

	const summary = branchExists
		? `¿Conectar rama existente ${branch} en ${targetPath}?`
		: `¿Crear rama ${branch} desde ${startLabel} en ${targetPath}?`;
	if (!(await uiConfirm("Crear Git worktree", summary))) return;

	assertTargetFilesystemAvailable(targetPath);
	await addWorktree(git, cwd, { path: targetPath, branch, startOid }, signal);
	let created: WorktreeRecord;
	try {
		const updated = await listWorktrees(git, cwd, signal);
		const verified = updated.find((record) => pathsEqual(record.path, targetPath));
		if (!verified || verified.branch !== branch) {
			throw new Error("el path y rama esperados no aparecieron en la salida de Git");
		}
		created = verified;
	} catch (error) {
		throw new Error(
			`Git add completó (worktree retenido en ${targetPath}), pero la verificación falló: ${formatError(error)}. Revisa 'git worktree list' antes de reintentar.`,
		);
	}
	uiNotify(`Worktree creado: ${targetPath} en rama ${branch}.`, "info");

	if (await uiConfirm("¿Abrir en ventana nueva?", `¿Continuar el trabajo en ${targetPath}?`)) {
		const latest = await revalidateWorktreeIdentity(fc, created);
		if (latest.prunableReason !== undefined || !existsSync(latest.path)) {
			throw new Error("El worktree recién creado dejó de estar disponible; selecciónalo de nuevo.");
		}
		await openWorktreeInNewWindow(latest.path);
	}
}

function assertTargetFilesystemAvailable(targetPath: string): void {
	if (pathEntryExists(targetPath)) {
		throw new Error(`El path destino ya existe: ${targetPath}.`);
	}
	const unsafeAncestor = unresolvableSymlinkAncestor(targetPath);
	if (unsafeAncestor) {
		throw new Error(`El path tiene un ancestro symlink irresoluble: ${unsafeAncestor}.`);
	}
}

async function openFlow(
	fc: FlowCtx,
	records: readonly WorktreeRecord[],
	currentPath: string,
): Promise<void> {
	const { signal } = fc;
	const candidates = records.filter(
		(record) =>
			!record.bare &&
			record.prunableReason === undefined &&
			existsSync(record.path) &&
			!pathsEqual(record.path, currentPath),
	);
	const selected = await selectWorktree("Abrir worktree", candidates, currentPath, signal);
	if (!selected) return;
	const latest = await revalidateWorktreeIdentity(fc, selected);
	if (
		latest.bare ||
		latest.prunableReason !== undefined ||
		!existsSync(latest.path) ||
		pathsEqual(latest.path, currentPath)
	) {
		throw new Error("El worktree seleccionado cambió de estado; selecciónalo de nuevo.");
	}
	await openWorktreeInNewWindow(latest.path);
}

async function removeFlow(
	fc: FlowCtx,
	records: readonly WorktreeRecord[],
	currentPath: string,
): Promise<void> {
	const { git, cwd, signal } = fc;
	const candidates = records.filter(
		(record) => !record.isMain && !record.bare && !pathsEqual(record.path, currentPath),
	);
	const selected = await selectWorktree("Remove linked worktree", candidates, currentPath, signal);
	if (!selected) return;
	if (selected.lockedReason !== undefined) {
		throw new Error(
			`Worktree bloqueado${selected.lockedReason ? `: ${selected.lockedReason}` : "."}. Desbloquéalo con Git antes de remover.`,
		);
	}
	if (selected.prunableReason !== undefined || !existsSync(selected.path)) {
		throw new Error("El path del worktree está obsoleto. Usa prune en vez de remove.");
	}

	const inventory = classifyRemovalInventory(await worktreeInventory(git, selected.path, signal));
	if (inventory.protected.length > 0) {
		throw new Error(
			`Removal rechazado: ${selected.path} contiene datos tracked/untracked/index/submodule:\n${inventory.protected.join("\n")}`,
		);
	}
	await assertDetachedHeadIsDurable(fc, selected);
	const administrativePath = await worktreeAdministrativeDirectory(git, selected.path, signal);
	const approvedHistoryRisks = historyRisks(
		selected.path,
		await unreachableAdministrativeHistoryOids(fc, administrativePath),
	);
	const recoveryWarning = formatAdministrativeRecoveryWarning(approvedHistoryRisks);
	const ignoredWarning = formatIgnoredDataWarning(inventory.ignored);
	const removalWarning =
		ignoredWarning && recoveryWarning
			? `${ignoredWarning}\n${recoveryWarning.trimStart()}`
			: `${ignoredWarning}${recoveryWarning}`;
	const confirmationTitle =
		inventory.ignored.length > 0
			? recoveryWarning
				? "Remove worktree y descartar datos locales/recovery"
				: "Remove worktree y borrar archivos ignorados"
			: recoveryWarning
				? "Remove worktree y descartar recovery history"
				: "Remove Git worktree";
	if (
		!(await uiConfirm(
			confirmationTitle,
			`¿Borrar el directorio ${selected.path}? La rama se conserva.${removalWarning}`,
		))
	) {
		return;
	}

	await assertAdministrativeHistoryUnchanged(fc, selected.path, administrativePath, approvedHistoryRisks);

	const beforeRemoval = await listWorktrees(git, cwd, signal);
	const latest = beforeRemoval.find((record) => pathsEqual(record.path, selected.path));
	if (!latest) throw new Error(`El worktree ${selected.path} ya no está registrado.`);
	if (!sameWorktreeIdentity(selected, latest)) {
		throw new Error(`El worktree ${selected.path} cambió de identidad; selecciónalo de nuevo.`);
	}
	if (latest.isMain || latest.lockedReason !== undefined || latest.prunableReason !== undefined) {
		throw new Error(`El worktree ${selected.path} cambió de estado tras confirmar; removal rechazado.`);
	}
	const latestInventory = classifyRemovalInventory(await worktreeInventory(git, latest.path, signal));
	if (latestInventory.protected.length > 0) {
		throw new Error(
			`Removal rechazado: aparecieron datos protegidos nuevos tras confirmar:\n${latestInventory.protected.join("\n")}`,
		);
	}
	if (!sameInventory(inventory.ignored, latestInventory.ignored)) {
		throw new Error(
			`Removal rechazado: los datos ignorados cambiaron tras confirmar:\n${latestInventory.ignored.join("\n") || "(ninguno)"}`,
		);
	}
	await assertDetachedHeadIsDurable(fc, latest);
	await assertAdministrativeHistoryUnchanged(fc, latest.path, administrativePath, approvedHistoryRisks);
	await removeWorktree(git, cwd, latest.path, signal);
	const updated = await listWorktrees(git, cwd, signal);
	if (updated.some((record) => pathsEqual(record.path, selected.path))) {
		throw new Error(`Git remove devolvió éxito, pero ${selected.path} sigue registrado.`);
	}
	uiNotify(`Worktree removido: ${selected.path}. La rama se conservó.`, "info");
}

async function pruneFlow(fc: FlowCtx, records: readonly WorktreeRecord[]): Promise<void> {
	const { git, cwd, signal } = fc;
	for (const record of records.filter(
		(candidate) => candidate.prunableReason !== undefined && candidate.detached,
	)) {
		await assertDetachedHeadIsDurable(fc, record);
	}
	const preview = await prunePreview(git, cwd, signal);
	if (!preview) {
		uiNotify("Git no encontró metadatos obsoletos para prune.", "info");
		return;
	}
	const approvedHistoryRisks = await inspectAdministrativePruneCandidates(fc);
	const safePreview = stripTerminalControls(preview);
	const recoveryWarning = formatAdministrativeRecoveryWarning(approvedHistoryRisks);
	uiNotify(`git worktree prune --dry-run --verbose\n${safePreview}`, "warning");
	if (
		!(await uiConfirm(
			recoveryWarning ? "Prune y descartar recovery history" : "Prune metadatos obsoletos",
			`${safePreview}${recoveryWarning}`,
		))
	) {
		return;
	}
	const latest = await listWorktrees(git, cwd, signal);
	for (const record of latest.filter(
		(candidate) => candidate.prunableReason !== undefined && candidate.detached,
	)) {
		await assertDetachedHeadIsDurable(fc, record);
	}
	const beforePreviewHistoryRisks = await inspectAdministrativePruneCandidates(fc);
	if (!sameAdministrativeHistoryRisks(approvedHistoryRisks, beforePreviewHistoryRisks)) {
		throw new Error("Los metadatos obsoletos cambiaron tras confirmar; ejecuta prune de nuevo.");
	}
	const latestPreview = await prunePreview(git, cwd, signal);
	const finalHistoryRisks = await inspectAdministrativePruneCandidates(fc);
	if (
		latestPreview !== preview ||
		!sameAdministrativeHistoryRisks(approvedHistoryRisks, finalHistoryRisks)
	) {
		throw new Error("Los metadatos obsoletos cambiaron tras confirmar; ejecuta prune de nuevo.");
	}
	const output = await pruneWorktrees(git, cwd, signal);
	uiNotify(
		output ? `Pruneado:\n${output}` : "Metadatos obsoletos pruneados.",
		"info",
	);
}

// ============================ Safety helpers (porte fiel) ============================

async function assertAdministrativeHistoryUnchanged(
	fc: FlowCtx,
	selectedPath: string,
	approvedAdministrativePath: string,
	approvedHistoryRisks: readonly AdministrativeHistoryRisk[],
): Promise<void> {
	const { git, signal } = fc;
	const latestAdministrativePath = await worktreeAdministrativeDirectory(git, selectedPath, signal);
	const latestHistoryRisks = historyRisks(
		selectedPath,
		await unreachableAdministrativeHistoryOids(fc, latestAdministrativePath),
	);
	if (
		!pathsEqual(approvedAdministrativePath, latestAdministrativePath) ||
		!sameAdministrativeHistoryRisks(approvedHistoryRisks, latestHistoryRisks)
	) {
		throw new Error(
			`La recovery history administrativa de ${selectedPath} cambió tras confirmar; selecciónalo de nuevo.`,
		);
	}
}

async function inspectAdministrativePruneCandidates(fc: FlowCtx): Promise<AdministrativeHistoryRisk[]> {
	const { git, cwd, signal } = fc;
	const risks: AdministrativeHistoryRisk[] = [];
	for (const candidate of await administrativePruneCandidates(git, cwd, signal)) {
		if (candidate.indexDirty) {
			throw new Error(
				`Prune rechazado: el worktree administrativo ${candidate.id} tiene cambios staged en el index.`,
			);
		}
		if (candidate.head) {
			const refs = await durableRefsContaining(git, cwd, candidate.head, signal);
			if (refs.length === 0) {
				throw new Error(
					`Prune rechazado: el worktree administrativo ${candidate.id} tiene detached HEAD ${candidate.head}, no alcanzable desde un ref durable.`,
				);
			}
		} else if (!candidate.branchRef || !(await durableRefExists(git, cwd, candidate.branchRef, signal))) {
			throw new Error(
				`Prune rechazado: el worktree administrativo ${candidate.id} no resuelve a un ref durable.`,
			);
		}
		risks.push(
			...historyRisks(
				candidate.id,
				await unreachableAdministrativeHistoryOids(fc, candidate.administrativePath),
			),
		);
	}
	return normalizeAdministrativeHistoryRisks(risks);
}

async function unreachableAdministrativeHistoryOids(
	fc: FlowCtx,
	administrativePath: string,
): Promise<string[]> {
	const { git, cwd, signal } = fc;
	const unreachable: string[] = [];
	for (const oid of await administrativeHistoryOids(git, cwd, administrativePath, signal)) {
		const refs = await durableRefsContaining(git, cwd, oid, signal);
		if (refs.length === 0) unreachable.push(oid);
	}
	return [...new Set(unreachable)].sort();
}

function historyRisks(label: string, oids: string[]): AdministrativeHistoryRisk[] {
	return oids.length > 0 ? [{ label, oids }] : [];
}

function normalizeAdministrativeHistoryRisks(
	risks: readonly AdministrativeHistoryRisk[],
): AdministrativeHistoryRisk[] {
	return risks
		.map((risk) => ({ label: risk.label, oids: [...new Set(risk.oids)].sort() }))
		.filter((risk) => risk.oids.length > 0)
		.sort((left, right) => left.label.localeCompare(right.label));
}

function sameAdministrativeHistoryRisks(
	left: readonly AdministrativeHistoryRisk[],
	right: readonly AdministrativeHistoryRisk[],
): boolean {
	return (
		JSON.stringify(normalizeAdministrativeHistoryRisks(left)) ===
		JSON.stringify(normalizeAdministrativeHistoryRisks(right))
	);
}

function formatAdministrativeRecoveryWarning(risks: readonly AdministrativeHistoryRisk[]): string {
	if (risks.length === 0) return "";
	const entries = risks
		.map((risk) => `${stripTerminalControls(risk.label)}: ${risk.oids.map(stripTerminalControls).join(", ")}`)
		.join("; ");
	return ` Advertencia de recovery administrativo: estos commits no son alcanzables desde una rama, tag o ref remoto: ${entries}. Descartar sus punteros de recovery significa que podrían ser garbage-collected después.`;
}

function classifyRemovalInventory(lines: readonly string[]): RemovalInventory {
	const ignored: string[] = [];
	const protectedData: string[] = [];
	for (const line of lines) {
		(line.startsWith("!! ") ? ignored : protectedData).push(line);
	}
	return {
		ignored: normalizeInventory(ignored),
		protected: normalizeInventory(protectedData),
	};
}

function normalizeInventory(lines: readonly string[]): string[] {
	return [...new Set(lines)].sort();
}

function sameInventory(left: readonly string[], right: readonly string[]): boolean {
	return JSON.stringify(normalizeInventory(left)) === JSON.stringify(normalizeInventory(right));
}

function formatIgnoredDataWarning(ignored: readonly string[]): string {
	if (ignored.length === 0) return "";
	return ` Archivos/directorios ignorados que se borrarán:\n${ignored.map(stripTerminalControls).join("\n")}`;
}

async function assertDetachedHeadIsDurable(fc: FlowCtx, record: WorktreeRecord): Promise<void> {
	const { git, cwd, signal } = fc;
	if (!record.detached) return;
	if (!record.head) throw new Error(`Worktree detached ${record.path} no tiene objeto HEAD; rechazado.`);
	const refs = await durableRefsContaining(git, cwd, record.head, signal);
	if (refs.length === 0) {
		throw new Error(
			`El detached HEAD ${record.head} en ${record.path} no es alcanzable desde una rama local, tag o ref remoto. Consérvalo antes de continuar.`,
		);
	}
}

async function revalidateWorktreeIdentity(
	fc: FlowCtx,
	selected: WorktreeRecord,
): Promise<WorktreeRecord> {
	const { git, cwd, signal } = fc;
	const latest = (await listWorktrees(git, cwd, signal)).find((record) =>
		pathsEqual(record.path, selected.path),
	);
	if (!latest) throw new Error(`El worktree ${selected.path} ya no está registrado.`);
	if (!sameWorktreeIdentity(selected, latest)) {
		throw new Error(`El worktree ${selected.path} cambió de identidad; selecciónalo de nuevo.`);
	}
	return latest;
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
