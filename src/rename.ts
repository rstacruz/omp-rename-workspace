import { homedir } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { detectWorkspace, run, type Workspace } from "./backend.ts";
import { MAX_NAME_LENGTH, namePrompt, parseCandidates, pickCandidate } from "./naming.ts";

/** `OMP_RENAME_WORKSPACE_AUTO=0` stops naming unnamed workspaces after a turn */
const AUTO = process.env.OMP_RENAME_WORKSPACE_AUTO !== "0";

function currentWorkspace(ctx: ExtensionContext): Workspace | undefined {
	return detectWorkspace({
		env: process.env,
		cwd: ctx.cwd,
		home: homedir(),
		run,
		hasCommand: command => Bun.which(command) !== null,
	});
}

/** Asks the model for names in a side turn, applies the best fit, and returns it */
async function nameWorkspace(ctx: ExtensionContext, workspace: Workspace, hint: string): Promise<string> {
	if (!ctx.runEphemeralTurn) throw new Error("this omp has no side turns (runEphemeralTurn)");
	const { replyText } = await ctx.runEphemeralTurn({ promptText: namePrompt(hint), minimizeEffort: true });
	const candidates = parseCandidates(replyText);
	const name = pickCandidate(candidates);
	if (!name) {
		throw new Error(candidates.length ? `no name fits in ${MAX_NAME_LENGTH} characters` : "the model sent no names");
	}
	await workspace.rename(name);
	return name;
}

export default function renameWorkspaceExtension(pi: ExtensionAPI) {
	pi.setLabel("/rename-workspace — name the workspace");

	// Set once this session tried auto-naming or was named by hand
	let settled = false;

	pi.on("session_start", () => {
		settled = false;
	});
	pi.on("session_switch", () => {
		settled = false;
	});

	pi.registerCommand("rename-workspace", {
		description: "Name this Paseo or Herdr workspace and the omp session after the conversation",
		handler: async (args, ctx) => {
			const workspace = currentWorkspace(ctx);
			if (!workspace) {
				ctx.ui.notify("/rename-workspace: not in a Paseo or Herdr workspace", "warning");
				return;
			}
			try {
				const name = await nameWorkspace(ctx, workspace, args);
				settled = true;
				// omp retitles the terminal whenever the session name changes
				await Promise.all([pi.setSessionName(name), workspace.renameTab?.(name)]);
				ctx.ui.notify(`${workspace.host} workspace: ${name}`, "info");
			} catch (error) {
				ctx.ui.notify(`/rename-workspace: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	if (!AUTO) return;

	// One try per session, after a turn, and only while the host still shows its derived name
	const autoName = async (ctx: ExtensionContext): Promise<void> => {
		const workspace = currentWorkspace(ctx);
		if (!workspace) return;
		try {
			if (await workspace.chosenName()) return;
			const name = await nameWorkspace(ctx, workspace, "");
			ctx.ui.notify(`${workspace.host} workspace: ${name}`, "info");
		} catch (error) {
			pi.logger.warn("rename-workspace: auto-name failed", { error: String(error) });
		}
	};

	pi.on("agent_end", (_event, ctx) => {
		if (ctx.agent.kind !== "main" || settled) return;
		settled = true;
		// Not awaited: the session stays responsive while the side turn runs
		void autoName(ctx);
	});
}
