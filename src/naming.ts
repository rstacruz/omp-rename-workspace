/** Longest name the sidebars show without truncating */
export const MAX_NAME_LENGTH = 33;

/** Side-turn prompt; a `/rename-workspace` hint is appended */
export const NAME_PROMPT = `
Name this workspace after what we are working on in this conversation. Go with what is in the conversation so far.

Reply with only a JSON object: {"candidates": ["<longer name>", "<shorter name>"]}

- 2 or 3 candidates, each at most ${MAX_NAME_LENGTH} characters.
- Format: \`<CODE>: <Title> · <ticket>\` when a ticket is known (e.g. ABC-123), else \`<CODE>: <Title>\`.
- CODE: 1-6 capital letters or digits, never more, that name the subject at a glance, made from one word or name in the title: the whole word when it has 6 letters or fewer (SEED, SCOPE, FREEZE, Z3, 404), else cut to its first syllable or leading consonants (PROV for provider, FLBK for fallback). Never initials of several words unless the user writes them so (CTA, SDK), nor a code that passes for an unrelated name.
- Title: a few words in sentence case.
`.trim();

/** Prompt with the user's hint, if any */
export function namePrompt(hint: string): string {
	const trimmed = hint.trim();
	return trimmed ? `${NAME_PROMPT}\n\nHint from the user: ${trimmed}` : NAME_PROMPT;
}

const isString = (value: unknown): value is string => typeof value === "string";

/** Candidate names from a reply, fenced or wrapped in prose */
export function parseCandidates(replyText: string): string[] {
	const unfenced = replyText.replace(/```[\w-]*\n([\s\S]*?)\n?```/g, "$1").trim();
	const start = unfenced.indexOf("{");
	const end = unfenced.lastIndexOf("}");
	if (start < 0 || end <= start) return [];
	try {
		const value: unknown = JSON.parse(unfenced.slice(start, end + 1));
		const candidates = (value as { candidates?: unknown } | null)?.candidates;
		if (!Array.isArray(candidates)) return [];
		return candidates.flatMap(candidate => (isString(candidate) && candidate.trim() ? [candidate.trim()] : []));
	} catch {
		return [];
	}
}

/** Characters, not UTF-16 units: names contain "·" */
const charLength = (text: string): number => [...text].length;

/** Longest candidate that fits; the first wins ties */
export function pickCandidate(candidates: readonly string[], max = MAX_NAME_LENGTH): string | undefined {
	let best: string | undefined;
	for (const candidate of candidates) {
		const length = charLength(candidate);
		if (length <= max && length > (best === undefined ? 0 : charLength(best))) best = candidate;
	}
	return best;
}

/** Zero-width characters some hosts pad names with */
const normalize = (name: string): string => name.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();

/** True when the name is one the host derived from the location, not one someone chose */
export function isAutomaticName(name: string, automaticNames: readonly (string | undefined)[]): boolean {
	const normalized = normalize(name);
	if (!normalized) return true;
	return automaticNames.some(auto => auto !== undefined && normalize(auto) === normalized);
}
