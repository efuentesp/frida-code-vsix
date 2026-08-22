export type DependencyCategory = "core" | "extension" | "optional";
export type SupportedPlatform = "win32" | "darwin" | "linux";

export interface InstallGuide {
	command: string;
	guide?: string;
	url?: string;
}

export interface DependencyStatus {
	id: string;
	name: string;
	category: DependencyCategory;
	installed: boolean;
	version?: string;
	path?: string;
	description: string;
	usedBy: string;
	notes?: string;
	installGuides: Record<SupportedPlatform, InstallGuide>;
}

export interface EnvironmentReport {
	platform: SupportedPlatform;
	platformLabel: string;
	arch: string;
	checkedAt: number;
	readyCount: number;
	totalCount: number;
	coreReady: boolean;
	dependencies: DependencyStatus[];
}
