import { basename, dirname } from "node:path";
import { type } from "@oh-my-pi/omptype";
import { isAutomaticName } from "./naming.ts";

export interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}

export type Run = (command: string, args: string[], options?: { input?: string }) => Promise<RunResult>;

const TIMEOUT_MS = 10_000;

/** Runs a command; a missing binary is exit 127, not a throw */
export const run: Run = async (command, args, options = {}) => {
	try {
		const proc = Bun.spawn([command, ...args], {
			stdin: options.input === undefined ? "ignore" : Buffer.from(options.input),
			stdout: "pipe",
			stderr: "pipe",
			timeout: TIMEOUT_MS,
		});
		const [stdout, stderr, code] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		return { code, stdout, stderr };
	} catch (error) {
		return { code: 127, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
	}
};

export interface Workspace {
	host: "Paseo" | "herdr-app" | "Herdr";
	/** Name someone chose; undefined while the host still derives it from the location */
	chosenName(): Promise<string | undefined>;
	rename(name: string): Promise<void>;
	/** Renames the tab holding this session, on hosts with tabs */
	renameTab?(name: string): Promise<void>;
}

export interface Host {
	env: Record<string, string | undefined>;
	cwd: string;
	home: string;
	run: Run;
	hasCommand(command: string): boolean;
}

/** Runs a command and returns stdout; a non-zero exit throws with its output */
async function stdoutOf(host: Host, command: string, args: string[], input?: string): Promise<string> {
	const result = await host.run(command, args, { input });
	if (result.code !== 0) {
		const output = (result.stderr.trim() || result.stdout.trim()).split("\n")[0] ?? "";
		throw new Error(`${command} ${args.slice(0, 2).join(" ")} failed${output ? `: ${output}` : ""}`);
	}
	return result.stdout;
}

/** Names Paseo and Herdr derive from a folder: its name, its repo's name, its branch */
export async function locationNames(host: Host, cwd: string): Promise<string[]> {
	const names = [basename(cwd)];
	if (cwd === host.home) names.push("~");
	const git = await host.run("git", [
		"-C",
		cwd,
		"rev-parse",
		"--path-format=absolute",
		"--show-toplevel",
		"--git-common-dir",
		"--abbrev-ref",
		"HEAD",
	]);
	if (git.code !== 0) return names;
	const [toplevel, commonDir, branch] = git.stdout.trim().split("\n");
	if (toplevel) names.push(basename(toplevel));
	// Worktrees: Herdr names them after the main checkout
	if (commonDir) names.push(basename(basename(commonDir) === ".git" ? dirname(commonDir) : commonDir));
	if (branch && branch !== "HEAD") names.push(branch);
	return names;
}

const PaseoRows = type({ workspaceId: "string", name: "string", cwd: "string" }).array();

function paseoWorkspace(host: Host, id: string): Workspace {
	const cli = host.env.PASEO_CLI || "paseo";
	return {
		host: "Paseo",
		async chosenName() {
			const rows = PaseoRows.assert(JSON.parse(await stdoutOf(host, cli, ["workspace", "ls", "--background", "--json"])));
			const row = rows.find(r => r.workspaceId === id);
			if (!row) throw new Error(`Paseo workspace ${id} not found`);
			// Untitled workspaces show their branch, else their folder name
			return isAutomaticName(row.name, await locationNames(host, row.cwd)) ? undefined : row.name;
		},
		async rename(name) {
			await stdoutOf(host, cli, ["workspace", "rename", id, name]);
		},
	};
}

const HcTerminal = type({ "labels?": "Record<string, string>" });

const HerdrAppLs = type({
	spaces: type({
		id: "string",
		tabs: type({ id: "string", terminals: type({ terminal: "string" }).array() }).array(),
	}).array(),
});

const DocReply = type({
	"result?": { "value?": { "spaces?": type({ id: "string", name: "string" }).array() } },
	"error?": { message: "string" },
});

/** The space and tab holding a herdr-app terminal */
interface HerdrAppPlace {
	space: string;
	tab: string;
}

function herdrAppWorkspace(host: Host, terminal: string): Workspace {
	let placed: Promise<HerdrAppPlace> | undefined;

	const findPlace = async (): Promise<HerdrAppPlace> => {
		const got = await host.run("hc", ["get", terminal, "--json"]);
		if (got.code === 0) {
			const labels = HcTerminal.assert(JSON.parse(got.stdout)).labels;
			const space = labels?.["herdr.space"];
			const tab = labels?.["herdr.tab"];
			if (space && tab) return { space, tab };
		}
		const { spaces } = HerdrAppLs.assert(JSON.parse(await stdoutOf(host, "herdr-app", ["ls"])));
		for (const space of spaces) {
			const tab = space.tabs.find(tab => tab.terminals.some(t => t.terminal === terminal));
			if (tab) return { space: space.id, tab: tab.id };
		}
		throw new Error(`no herdr-app space holds terminal ${terminal}`);
	};

	const place = (): Promise<HerdrAppPlace> => {
		placed ??= findPlace().catch(error => {
			placed = undefined;
			throw error;
		});
		return placed;
	};

	return {
		host: "herdr-app",
		async chosenName() {
			const id = (await place()).space;
			// `herdr-app ls` shows the derived name; the stored one is "" until someone names the space
			const request = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "doc.get", params: { name: "herdr-app" } });
			const reply = DocReply.assert(JSON.parse(await stdoutOf(host, "hc", ["connect"], `${request}\n`)));
			if (reply.error) throw new Error(`hc doc.get failed: ${reply.error.message}`);
			const stored = reply.result?.value?.spaces?.find(s => s.id === id);
			if (!stored) throw new Error(`herdr-app space ${id} not found`);
			return stored.name.trim() || undefined;
		},
		async rename(name) {
			await stdoutOf(host, "herdr-app", ["do", "space.rename", "--id", (await place()).space, "--name", name]);
		},
		async renameTab(name) {
			await stdoutOf(host, "herdr-app", ["do", "tab.rename", "--id", (await place()).tab, "--name", name]);
		},
	};
}

const HerdrGet = type({ result: { workspace: { label: "string" } } });

function herdrWorkspace(host: Host, id: string): Workspace {
	return {
		host: "Herdr",
		async chosenName() {
			const { label } = HerdrGet.assert(JSON.parse(await stdoutOf(host, "herdr", ["workspace", "get", id]))).result.workspace;
			// The API returns the derived label when none was set
			return isAutomaticName(label, [...(await locationNames(host, host.cwd)), "workspace"]) ? undefined : label;
		},
		async rename(name) {
			await stdoutOf(host, "herdr", ["workspace", "rename", id, name]);
		},
	};
}

/** The workspace this session runs in: Paseo first, then herdr-app, then Herdr */
export function detectWorkspace(host: Host): Workspace | undefined {
	const { PASEO_WORKSPACE_ID, HC_TERMINAL_ID, HERDR_WORKSPACE_ID } = host.env;
	if (PASEO_WORKSPACE_ID) return paseoWorkspace(host, PASEO_WORKSPACE_ID);
	if (HC_TERMINAL_ID && host.hasCommand("herdr-app")) return herdrAppWorkspace(host, HC_TERMINAL_ID);
	if (HERDR_WORKSPACE_ID) return herdrWorkspace(host, HERDR_WORKSPACE_ID);
	return undefined;
}
