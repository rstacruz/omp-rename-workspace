import { describe, expect, test } from "bun:test";
import { isAutomaticName, parseCandidates, pickCandidate } from "./naming.ts";

describe("parseCandidates", () => {
	test("reads candidates from plain, fenced, or wrapped JSON", () => {
		expect(parseCandidates('{"candidates": ["SEED: Seed data", "SEED: Seed"]}')).toEqual(["SEED: Seed data", "SEED: Seed"]);
		expect(parseCandidates('```json\n{"candidates": ["A: b"]}\n```')).toEqual(["A: b"]);
		expect(parseCandidates('Sure:\n{"candidates": ["A: b"]}\nDone.')).toEqual(["A: b"]);
	});

	test("drops blanks and non-strings", () => {
		expect(parseCandidates('{"candidates": [" A: b ", "", 3, null]}')).toEqual(["A: b"]);
	});

	test("returns nothing without a candidates array", () => {
		expect(parseCandidates("no JSON here")).toEqual([]);
		expect(parseCandidates('{"candidates": "A: b"}')).toEqual([]);
		expect(parseCandidates("{not json}")).toEqual([]);
	});
});

describe("pickCandidate", () => {
	test("picks the longest that fits, first on ties", () => {
		expect(pickCandidate(["AB: one", "AB: three", "AB: seven"], 9)).toBe("AB: three");
	});

	test("counts characters, not UTF-16 units", () => {
		const name = "SEED: Seed data · ABC-123"; // 25 characters
		expect(pickCandidate([name], 25)).toBe(name);
		expect(pickCandidate(["🙂".repeat(3)], 3)).toBe("🙂🙂🙂");
	});

	test("returns undefined when nothing fits", () => {
		expect(pickCandidate(["far too long a name"], 5)).toBeUndefined();
		expect(pickCandidate([])).toBeUndefined();
	});
});

describe("isAutomaticName", () => {
	test("matches derived names, ignoring zero-width padding", () => {
		expect(isAutomaticName("monorepo", ["monorepo", "main"])).toBe(true);
		expect(isAutomaticName("Home\u200B", ["Home"])).toBe(true);
		expect(isAutomaticName("  ", [])).toBe(true);
	});

	test("treats anything else as chosen", () => {
		expect(isAutomaticName("SEED: Seed data", ["monorepo", undefined])).toBe(false);
	});
});
