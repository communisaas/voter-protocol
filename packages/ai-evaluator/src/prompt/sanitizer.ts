/**
 * Input sanitization (Layer 1 of 6-layer prompt injection defense).
 *
 * Strips control characters, enforces length limits, and wraps argument text
 * in explicit data delimiters so the LLM treats it as content, not instructions.
 */

/** Maximum argument text length (10,000 chars) */
const MAX_ARGUMENT_LENGTH = 10_000;

/** Control character regex: strips C0 controls except \t \n \r */
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Sanitize raw argument text for safe inclusion in evaluation prompts.
 *
 * - Strips ASCII control characters (except tab, newline, carriage return)
 * - Truncates to MAX_ARGUMENT_LENGTH characters
 * - Trims leading/trailing whitespace
 */
export function sanitizeArgumentText(raw: string): string {
	let text = raw.replace(CONTROL_CHARS, '');
	text = text.trim();
	if (text.length > MAX_ARGUMENT_LENGTH) {
		text = text.slice(0, MAX_ARGUMENT_LENGTH);
	}
	return text;
}

/**
 * Wrap a sanitized argument in XML-style data delimiters.
 * The evaluation prompt instructs the model to treat everything inside
 * <argument> tags as user-submitted content to evaluate, not as instructions.
 */
export function wrapArgument(
	index: number,
	stance: string,
	bodyText: string,
	amendmentText?: string,
): string {
	const sanitizedBody = sanitizeArgumentText(bodyText);
	let wrapped = `<argument index="${index}" stance="${stance}">\n${sanitizedBody}`;
	if (amendmentText) {
		const sanitizedAmendment = sanitizeArgumentText(amendmentText);
		wrapped += `\n<amendment>${sanitizedAmendment}</amendment>`;
	}
	wrapped += '\n</argument>';
	return wrapped;
}
