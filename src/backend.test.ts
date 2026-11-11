import { describe, expect, test } from "bun:test";
import { detectWorkspace, type Host, type RunResult } from "./backend.ts";

type Reply = RunResult | ((args: string[], input?: string) => RunResult);

const ok = (stdout: string): RunResult => ({ code: 0, stdout, stderr: "" });

const json = (value: object): RunResult => ok(JSON.stringify(value));

/** Fake host: replies keyed by command plus its first argument */
function fakeHost(env: Record<string, string>, replies: Record<string, Reply>, commands = ["herdr-app"]) {
	const calls: string[][] = [];
	const host: Host = {
		env,
		cwd: "/src/app",
		home: "/home/me",
		hasCommand: command => commands.includes(command),
		run: async (command, args, options) => {
			calls.push([command, ...args]);
			const reply = replies[`${command} ${args[0]}`] ?? replies[command];
			if (!reply) return { code: 1, stdout: "", stderr: `${command}: unexpected` };
			return typeof reply === "function" ? reply(args, options?.input) : reply;
		},
	};
	return { host, calls };
}

const gitIn = (toplevel: string, branch: string) => ok(`${toplevel}\n${toplevel}/.git\n${branch}\n`);

describe("detectWorkspace", () => {
	test("prefers Paseo, then herdr-app, then Herdr", () => {
		const all = { PASEO_WORKSPACE_ID: "wks_1", HC_TERMINAL_ID: "t1", HERDR_WORKSPACE_ID: "w1" };
		expect(detectWorkspace(fakeHost(all, {}).host)?.host).toBe("Paseo");
		expect(detectWorkspace(fakeHost({ HC_TERMINAL_ID: "t1", HERDR_WORKSPACE_ID: "w1" }, {}).host)?.host).toBe("herdr-app");
		expect(detectWorkspace(fakeHost({ HC_TERMINAL_ID: "t1", HERDR_WORKSPACE_ID: "w1" }, {}, []).host)?.host).toBe("Herdr");
		expect(detectWorkspace(fakeHost({}, {}).host)).toBeUndefined();
	});
});

describe("Paseo", () => {
	const ls = (name: string) => json([{ workspaceId: "wks_1", name, cwd: "/src/app", project: "app" }]);

	test("a branch or folder name is not chosen", async () => {
		for (const name of ["feature/x", "app"]) {
			const { host } = fakeHost({ PASEO_WORKSPACE_ID: "wks_1" }, { "paseo workspace": ls(name), git: gitIn("/src/app", "feature/x") });
			expect(await detectWorkspace(host)?.chosenName()).toBeUndefined();
		}
	});

	test("a title is chosen", async () => {
		const { host } = fakeHost({ PASEO_WORKSPACE_ID: "wks_1" }, { "paseo workspace": ls("SEED: Seed data"), git: gitIn("/src/app", "main") });
		expect(await detectWorkspace(host)?.chosenName()).toBe("SEED: Seed data");
	});

	test("renames with PASEO_CLI when set", async () => {
		const { host, calls } = fakeHost({ PASEO_WORKSPACE_ID: "wks_1", PASEO_CLI: "/opt/paseo" }, { "/opt/paseo": ok("") });
		await detectWorkspace(host)?.rename("SEED: Seed data");
		expect(calls).toEqual([["/opt/paseo", "workspace", "rename", "wks_1", "SEED: Seed data"]]);
	});

	test("a failed rename throws with the CLI's error", async () => {
		const { host } = fakeHost({ PASEO_WORKSPACE_ID: "wks_1" }, { paseo: { code: 1, stdout: "", stderr: "Workspace not found\n" } });
		await expect(detectWorkspace(host)?.rename("X: y")).rejects.toThrow("Workspace not found");
	});
});

describe("herdr-app", () => {
	const doc = (name: string) =>
		json({ jsonrpc: "2.0", id: 1, result: { value: { spaces: [{ id: "sp9", name: "x" }, { id: "sp1", name, tabs: [] }] } } });

	test("reads the stored name of the terminal's space", async () => {
		const replies = { "hc get": json({ labels: { "herdr.space": "sp1" } }), "hc connect": doc("SEED: Seed data") };
		expect(await detectWorkspace(fakeHost({ HC_TERMINAL_ID: "t1" }, replies).host)?.chosenName()).toBe("SEED: Seed data");
	});

	test("an empty stored name is not chosen", async () => {
		const replies = { "hc get": json({ labels: { "herdr.space": "sp1" } }), "hc connect": doc("") };
		expect(await detectWorkspace(fakeHost({ HC_TERMINAL_ID: "t1" }, replies).host)?.chosenName()).toBeUndefined();
	});

	test("finds the space through herdr-app ls when the terminal has no label", async () => {
		const spaces = [{ id: "sp1", tabs: [{ terminals: [{ terminal: "t1" }] }] }];
		const { host, calls } = fakeHost(
			{ HC_TERMINAL_ID: "t1" },
			{ "hc get": json({ labels: {} }), "herdr-app ls": json({ spaces }), "herdr-app do": ok("") },
		);
		await detectWorkspace(host)?.rename("SEED: Seed data");
		expect(calls.at(-1)).toEqual(["herdr-app", "do", "space.rename", "--id", "sp1", "--name", "SEED: Seed data"]);
	});
});

describe("Herdr", () => {
	const get = (label: string) => json({ id: "cli", result: { type: "workspace_info", workspace: { label, workspace_id: "w1" } } });

	test("the repo, folder, or fallback label is not chosen", async () => {
		for (const label of ["app", "workspace"]) {
			const { host } = fakeHost({ HERDR_WORKSPACE_ID: "w1" }, { herdr: get(label), git: gitIn("/src/app", "main") }, []);
			expect(await detectWorkspace(host)?.chosenName()).toBeUndefined();
		}
	});

	test("a worktree's default label is the main checkout's name", async () => {
		const git = ok("/src/app-wt\n/src/app/.git\nfeature\n");
		const { host } = fakeHost({ HERDR_WORKSPACE_ID: "w1" }, { herdr: get("app"), git }, []);
		expect(await detectWorkspace(host)?.chosenName()).toBeUndefined();
	});

	test("a custom label is chosen", async () => {
		const { host } = fakeHost({ HERDR_WORKSPACE_ID: "w1" }, { herdr: get("AVEN: upkeep"), git: gitIn("/src/app", "main") }, []);
		expect(await detectWorkspace(host)?.chosenName()).toBe("AVEN: upkeep");
	});
});
