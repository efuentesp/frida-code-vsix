// frida-extensible-workflows · panel (issue #7 reapertura) — re-montaje del
// panel cuando la webBridge cambia. Reproduce el fallo reportado en el conteo
// COSMIC de SIV (2026-09-04): newSession() dispone la webBridge vieja, pero el
// singleton wired/mounted devolvía el mount STALE → el panel desaparecía para
// TODA sesión posterior a la primera del extension host.

import { describe, it, expect, vi, beforeEach } from "vitest";

// El panel real importa React vía WorkflowPanel.tsx; para este test basta un
// elemento dummy (el montaje real lo hace la bridge mock).
vi.mock("../../src/tools/frida-extensible-workflows/WorkflowPanel", () => ({
	createExtensibleWorkflowPanelElement: () => ({ type: "test-panel" }),
}));

import {
	wireExtensibleWorkflowPanel,
	remountExtensibleWorkflowPanel,
	_resetExtensibleWorkflowPanel,
} from "../../src/tools/frida-extensible-workflows/panel";

interface BridgeState {
	mountPersistent: ReturnType<typeof vi.fn>;
	mountCount: () => number;
	unmountCount: () => number;
}

/** Bridge mock: cuenta mounts y unmounts (los unmounts pueden lanzar). */
function makeBridge(opts?: { throwOnUnmount?: boolean }): BridgeState {
	let mounts = 0;
	let unmounts = 0;
	const state: BridgeState = {
		mountPersistent: vi.fn(() => {
			mounts++;
			return {
				unmount: () => {
					unmounts++;
					if (opts?.throwOnUnmount) throw new Error("bridge disposed");
				},
			};
		}),
		mountCount: () => mounts,
		unmountCount: () => unmounts,
	};
	return state;
}

describe("wireExtensibleWorkflowPanel (issue #7 reapertura)", () => {
	beforeEach(() => {
		_resetExtensibleWorkflowPanel();
	});

	it("monta una sola vez con la misma bridge (idempotente)", () => {
		const b1 = makeBridge();
		const first = wireExtensibleWorkflowPanel(b1 as never);
		const second = wireExtensibleWorkflowPanel(b1 as never);
		expect(b1.mountCount()).toBe(1);
		expect(second).toBe(first);
	});

	it("re-monta sobre la bridge nueva y desmonta el mount stale (nueva sesión)", () => {
		const b1 = makeBridge();
		const b2 = makeBridge();
		wireExtensibleWorkflowPanel(b1 as never);
		const mount2 = wireExtensibleWorkflowPanel(b2 as never);

		expect(b1.mountCount()).toBe(1);
		expect(b1.unmountCount()).toBe(1); // el mount viejo se desmontó
		expect(b2.mountCount()).toBe(1); // montó sobre la bridge nueva
		expect(mount2).toBeDefined();
		expect(b2.mountPersistent).toHaveBeenCalledWith(
			expect.any(Function),
			"footer",
		);
	});

	it("el unmount de una bridge ya dispuesta no rompe el re-montaje", () => {
		const b1 = makeBridge({ throwOnUnmount: true });
		const b2 = makeBridge();
		expect(() => wireExtensibleWorkflowPanel(b1 as never)).not.toThrow();
		expect(() => wireExtensibleWorkflowPanel(b2 as never)).not.toThrow();
		expect(b2.mountCount()).toBe(1);
	});

	it("remountExtensibleWorkflowPanel re-monta aunque la bridge no haya cambiado (webview recreado)", () => {
		const b1 = makeBridge();
		wireExtensibleWorkflowPanel(b1 as never);
		expect(b1.mountCount()).toBe(1);

		remountExtensibleWorkflowPanel(b1 as never);
		expect(b1.mountCount()).toBe(2);
		expect(b1.unmountCount()).toBe(1);
	});
});
