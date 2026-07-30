import { describe, it, expect } from "vitest";
import {
	getAllowedDomainsViolation,
	isHostAllowedByDomains,
	parseAllowedDomainsPolicyFromArgs,
} from "../../src/tools/frida-agent-browser/navigation-policy";

describe("parseAllowedDomainsPolicyFromArgs", () => {
	it("--allowed-domains <val> (coma/espacio)", () => {
		const p = parseAllowedDomainsPolicyFromArgs([
			"--allowed-domains",
			"a.com,b.com c.com",
			"open",
			"https://x",
		])!;
		expect(p.allowedDomains).toEqual(["a.com", "b.com", "c.com"]);
		expect(p.display).toBe("a.com, b.com, c.com");
	});
	it("--allowed-domains=<val>", () => {
		expect(
			parseAllowedDomainsPolicyFromArgs([
				"--allowed-domains=x.com",
				"open",
				"y",
			])?.allowedDomains,
		).toEqual(["x.com"]);
	});
	it("normaliza: URL form, *., trailing dot, path/port", () => {
		expect(
			parseAllowedDomainsPolicyFromArgs([
				"--allowed-domains=https://z.com/path",
			])?.allowedDomains,
		).toEqual(["z.com"]);
		expect(
			parseAllowedDomainsPolicyFromArgs(["--allowed-domains=*.w.com"])
				?.allowedDomains,
		).toEqual(["w.com"]);
		expect(
			parseAllowedDomainsPolicyFromArgs(["--allowed-domains=v.com."])
				?.allowedDomains,
		).toEqual(["v.com"]);
		expect(
			parseAllowedDomainsPolicyFromArgs(["--allowed-domains=u.com:8080"])
				?.allowedDomains,
		).toEqual(["u.com"]);
	});
	it("dedupe", () => {
		expect(
			parseAllowedDomainsPolicyFromArgs(["--allowed-domains=a.com,a.com"])
				?.allowedDomains,
		).toEqual(["a.com"]);
	});
	it("sin flag → undefined", () => {
		expect(
			parseAllowedDomainsPolicyFromArgs(["open", "https://x"]),
		).toBeUndefined();
	});
});

describe("isHostAllowedByDomains", () => {
	const domains = ["example.com"];
	it("coincide exacto", () => {
		expect(isHostAllowedByDomains("example.com", domains)).toBe(true);
	});
	it("subdominio permitido", () => {
		expect(isHostAllowedByDomains("sub.example.com", domains)).toBe(true);
	});
	it("dominio distinto → no", () => {
		expect(isHostAllowedByDomains("evil.com", domains)).toBe(false);
		expect(isHostAllowedByDomains("notexample.com", domains)).toBe(false); // no es subdominio
	});
});

describe("getAllowedDomainsViolation", () => {
	const policy = parseAllowedDomainsPolicyFromArgs([
		"--allowed-domains",
		"allowed.com",
	])!;
	it("host permitido → undefined", () => {
		expect(
			getAllowedDomainsViolation({
				policy,
				url: "https://sub.allowed.com/page",
			}),
		).toBeUndefined();
	});
	it("host fuera del allowlist → violación", () => {
		const v = getAllowedDomainsViolation({
			policy,
			url: "https://evil.com/x",
		})!;
		expect(v.observedHost).toBe("evil.com");
		expect(v.summary).toMatch(/does not allow evil.com/);
	});
	it("sin policy o sin url → undefined", () => {
		expect(getAllowedDomainsViolation({ url: "https://x" })).toBeUndefined();
		expect(getAllowedDomainsViolation({ policy })).toBeUndefined();
	});
	it("url no-http → undefined (no se evalúa)", () => {
		expect(
			getAllowedDomainsViolation({ policy, url: "file:///x" }),
		).toBeUndefined();
	});
});
