import DOMPurify from 'dompurify';

import type {
	MarkupLanguage,
	PlaygroundState,
	PreviewColorScheme,
	PreviewIssue,
	PreviewIssueSeverity,
	PreviewRender,
} from './types';
import { loadPugBrowserRenderer } from './pug-browser';

const PREVIEW_CSP = [
	"default-src 'none'",
	"base-uri 'none'",
	"connect-src 'none'",
	"font-src https: data:",
	"form-action 'none'",
	"frame-src 'none'",
	"img-src https: data:",
	"media-src https: data:",
	"navigate-to 'none'",
	"object-src 'none'",
	"script-src 'none'",
	"style-src 'unsafe-inline' https: data:",
	"worker-src 'none'",
].join('; ');

const DISALLOWED_BODY_TAGS = new Set([
	'base',
	'embed',
	'frame',
	'frameset',
	'iframe',
	'link',
	'meta',
	'object',
	'portal',
	'script',
	'title',
]);

const URL_ATTRIBUTES = new Set(['cite', 'data', 'href', 'poster', 'src', 'xlink:href']);
const SAFE_HEAD_TAGS = new Set(['link', 'meta', 'style', 'title']);
const SAFE_HEAD_LINK_RELATIONS = new Set([
	'apple-touch-icon',
	'dns-prefetch',
	'icon',
	'mask-icon',
	'preconnect',
	'preload',
	'stylesheet',
]);
const PREVIEW_BASE_STYLES = [
	'html {',
	'  background: Canvas;',
	'  color: CanvasText;',
	'}',
	'',
	'body {',
	'  background: Canvas;',
	'  color: CanvasText;',
	'}',
].join('\n');

let markedModulePromise: Promise<typeof import('marked')> | undefined;

function loadMarkedModule() {
	markedModulePromise ??= import('marked');
	return markedModulePromise;
}

function escapeHtml(value: string) {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function escapeStyleText(value: string) {
	return value.replaceAll(/<\/style/gi, '<\\/style');
}

function createIssueCollector() {
	let issueIndex = 0;
	const issues: PreviewIssue[] = [];

	return {
		issues,
		add(message: string, severity: PreviewIssueSeverity) {
			issueIndex += 1;
			issues.push({
				id: `issue-${issueIndex}`,
				message,
				severity,
			});
		},
	};
}

async function renderMarkup(source: string, language: MarkupLanguage) {
	try {
		switch (language) {
			case 'html':
				return {
					ok: true as const,
					html: source,
				};
			case 'markdown': {
				const { marked } = await loadMarkedModule();
				return {
					ok: true as const,
					html: marked.parse(source, {
						async: false,
						breaks: false,
						gfm: true,
					}) as string,
				};
			}
			case 'pug': {
				const pug = await loadPugBrowserRenderer();
				return {
					ok: true as const,
					html: pug.render(source, {
						doctype: 'html',
					}),
				};
			}
		}
	} catch (error) {
		return {
			ok: false as const,
			message: error instanceof Error ? error.message : 'Unknown rendering error.',
		};
	}
}

function normalizeRenderedHtml(html: string) {
	if (!/<(?:!doctype|html|head|body)\b/i.test(html)) {
		return html;
	}

	const parser = new DOMParser();
	const document = parser.parseFromString(html, 'text/html');
	return document.body.innerHTML;
}

function isAllowedAbsoluteUrl(
	value: string,
	options?: {
		allowData?: boolean;
		allowFragment?: boolean;
	},
) {
	const trimmed = value.trim();

	if (!trimmed) {
		return false;
	}

	if (options?.allowFragment && trimmed.startsWith('#')) {
		return true;
	}

	try {
		const parsed = new URL(trimmed);
		return (
			parsed.protocol === 'https:' || (options?.allowData === true && parsed.protocol === 'data:')
		);
	} catch {
		return false;
	}
}

function sanitizeSrcSet(value: string) {
	const sanitizedEntries = value
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean)
		.flatMap((entry) => {
			const [candidateUrl, ...rest] = entry.split(/\s+/);

			if (!isAllowedAbsoluteUrl(candidateUrl, { allowData: true })) {
				return [];
			}

			return [`${candidateUrl}${rest.length > 0 ? ` ${rest.join(' ')}` : ''}`];
		});

	return sanitizedEntries.join(', ');
}

function sanitizeBodyHtml(html: string, addIssue: (message: string, severity: PreviewIssueSeverity) => void) {
	const fragment = DOMPurify.sanitize(html, {
		FORBID_TAGS: [...DISALLOWED_BODY_TAGS],
		RETURN_DOM_FRAGMENT: true,
	}) as DocumentFragment;

	for (const element of Array.from(fragment.querySelectorAll('*'))) {
		const tagName = element.tagName.toLowerCase();

		for (const attribute of Array.from(element.attributes)) {
			const attributeName = attribute.name.toLowerCase();
			const value = attribute.value;

			if (attributeName.startsWith('on')) {
				element.removeAttribute(attribute.name);
				addIssue(`Removed inline event handler "${attribute.name}".`, 'warning');
				continue;
			}

			if (attributeName === 'action' || attributeName === 'formaction' || attributeName === 'target') {
				element.removeAttribute(attribute.name);
				addIssue(`Removed unsupported attribute "${attribute.name}".`, 'warning');
				continue;
			}

			if (attributeName === 'srcset') {
				const sanitizedSrcSet = sanitizeSrcSet(value);

				if (!sanitizedSrcSet) {
					element.removeAttribute(attribute.name);
					addIssue('Removed an unsafe srcset attribute.', 'warning');
					continue;
				}

				element.setAttribute(attribute.name, sanitizedSrcSet);
				continue;
			}

			if (!URL_ATTRIBUTES.has(attributeName)) {
				continue;
			}

			const allowsData = attributeName !== 'href';
			const allowsFragment = attributeName === 'href' && tagName === 'a';

			if (!isAllowedAbsoluteUrl(value, { allowData: allowsData, allowFragment: allowsFragment })) {
				element.removeAttribute(attribute.name);
				addIssue(`Removed an unsafe URL from "${attribute.name}".`, 'warning');
			}
		}
	}

	const container = document.createElement('div');
	container.append(fragment);
	return container.innerHTML;
}

function serializeAttributes(entries: Array<[string, string]>) {
	return entries
		.map(([name, value]) => {
			if (!value) {
				return ` ${name}`;
			}

			return ` ${name}="${escapeHtml(value)}"`;
		})
		.join('');
}

function sanitizeHtmlAttributes(
	raw: string,
	lang: string,
	addIssue: (message: string, severity: PreviewIssueSeverity) => void,
) {
	const parser = new DOMParser();
	const document = parser.parseFromString(`<!doctype html><html ${raw}></html>`, 'text/html');
	const attributes = Array.from(document.documentElement.attributes);
	const sanitizedAttributes: Array<[string, string]> = [['lang', lang || 'en']];

	for (const attribute of attributes) {
		const attributeName = attribute.name.toLowerCase();

		if (attributeName === 'lang') {
			addIssue('Ignored the lang attribute from additional html attributes.', 'warning');
			continue;
		}

		if (attributeName.startsWith('on')) {
			addIssue(`Removed unsupported html attribute "${attribute.name}".`, 'warning');
			continue;
		}

		sanitizedAttributes.push([attribute.name, attribute.value]);
	}

	return serializeAttributes(sanitizedAttributes);
}

function sanitizeHeadTags(
	raw: string,
	addIssue: (message: string, severity: PreviewIssueSeverity) => void,
) {
	if (!raw.trim()) {
		return '';
	}

	const parser = new DOMParser();
	const document = parser.parseFromString(
		`<!doctype html><html><head>${raw}</head><body></body></html>`,
		'text/html',
	);
	const parts: string[] = [];

	for (const node of Array.from(document.head.childNodes)) {
		if (node.nodeType === Node.TEXT_NODE) {
			if (node.textContent?.trim()) {
				addIssue('Ignored free text inside additional head tags.', 'warning');
			}

			continue;
		}

		if (node.nodeType !== Node.ELEMENT_NODE) {
			continue;
		}

		const element = node as HTMLElement;
		const tagName = element.tagName.toLowerCase();

		if (!SAFE_HEAD_TAGS.has(tagName)) {
			addIssue(`Removed unsupported head tag <${tagName}>.`, 'warning');
			continue;
		}

		if (tagName === 'title') {
			parts.push(`<title>${escapeHtml(element.textContent ?? '')}</title>`);
			continue;
		}

		if (tagName === 'style') {
			const attributes = Array.from(element.attributes)
				.filter((attribute) => !attribute.name.toLowerCase().startsWith('on'))
				.map((attribute) => [attribute.name, attribute.value] as [string, string]);
			parts.push(
				`<style${serializeAttributes(attributes)}>${escapeStyleText(
					element.textContent ?? '',
				)}</style>`,
			);
			continue;
		}

		if (tagName === 'meta') {
			if (
				element.hasAttribute('http-equiv') ||
				element.hasAttribute('charset') ||
				element.hasAttribute('content-security-policy')
			) {
				addIssue('Removed an unsafe meta tag from additional head tags.', 'warning');
				continue;
			}

			const attributes = Array.from(element.attributes)
				.filter((attribute) => !attribute.name.toLowerCase().startsWith('on'))
				.map((attribute) => [attribute.name, attribute.value] as [string, string]);

			parts.push(`<meta${serializeAttributes(attributes)} />`);
			continue;
		}

		if (tagName === 'link') {
			const relation = element.getAttribute('rel')?.trim().toLowerCase() ?? '';
			const href = element.getAttribute('href')?.trim() ?? '';
			const relationTokens = relation.split(/\s+/).filter(Boolean);

			if (
				relationTokens.length === 0 ||
				relationTokens.some((token) => !SAFE_HEAD_LINK_RELATIONS.has(token))
			) {
				addIssue('Removed an unsupported link tag from additional head tags.', 'warning');
				continue;
			}

			if (!isAllowedAbsoluteUrl(href)) {
				addIssue('Removed an unsafe link URL from additional head tags.', 'warning');
				continue;
			}

			const attributes = Array.from(element.attributes)
				.filter((attribute) => !attribute.name.toLowerCase().startsWith('on'))
				.map((attribute) => [attribute.name, attribute.value] as [string, string]);
			parts.push(`<link${serializeAttributes(attributes)} />`);
		}
	}

	return parts.join('\n');
}

function buildExternalCssLinks(
	raw: string,
	addIssue: (message: string, severity: PreviewIssueSeverity) => void,
) {
	const urls = raw
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const uniqueUrls = [...new Set(urls)];

	return uniqueUrls
		.map((url) => {
			if (!isAllowedAbsoluteUrl(url)) {
				addIssue(`Skipped an unsafe external CSS URL: ${url}`, 'warning');
				return '';
			}

			return `<link rel="stylesheet" href="${escapeHtml(url)}" />`;
		})
		.filter(Boolean)
		.join('\n');
}

function buildPreviewDocument(
	state: PlaygroundState,
	bodyHtml: string,
	headTags: string,
	htmlAttributes: string,
	externalCssLinks: string,
) {
	const colorSchemeTag =
		state.settings.colorScheme === 'light-dark'
			? '<meta name="color-scheme" content="light dark" />'
			: '';

	const inlineStyles = state.documents.styles.trim()
		? `<style>${escapeStyleText(state.documents.styles)}</style>`
		: '';

	return `<!doctype html>
<html${htmlAttributes}>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(PREVIEW_CSP)}" />
${colorSchemeTag}
<title>Preview</title>
<style>${PREVIEW_BASE_STYLES}</style>
${externalCssLinks}
${headTags}
${inlineStyles}
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

function buildErrorDocument(message: string, colorScheme: PlaygroundState['settings']['colorScheme']) {
	const colorSchemeTag =
		colorScheme === 'light-dark' ? '<meta name="color-scheme" content="light dark" />' : '';

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(PREVIEW_CSP)}" />
${colorSchemeTag}
<style>
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 2rem;
  font-family: Inter, "Segoe UI", sans-serif;
  background: #f8fafc;
  color: #0f172a;
}

.error-card {
  width: min(42rem, 100%);
  border-radius: 1rem;
  border: 1px solid rgba(220, 38, 38, 0.2);
  background: #fff;
  padding: 1.5rem;
  box-shadow: 0 18px 50px rgba(148, 163, 184, 0.25);
}

h1 {
  margin-top: 0;
}

pre {
  overflow: auto;
  white-space: pre-wrap;
  border-radius: 0.75rem;
  background: #0f172a;
  color: #e2e8f0;
  padding: 1rem;
}

@media (prefers-color-scheme: dark) {
  body {
    background: #020617;
    color: #e2e8f0;
  }

  .error-card {
    border-color: rgba(248, 113, 113, 0.3);
    background: #111827;
    box-shadow: 0 18px 50px rgba(2, 6, 23, 0.5);
  }
}
</style>
</head>
<body>
  <main class="error-card">
    <h1>Preview error</h1>
    <p>The selected markup could not be rendered.</p>
    <pre>${escapeHtml(message)}</pre>
  </main>
</body>
</html>`;
}

function buildPendingDocument(colorScheme: PreviewColorScheme) {
	const colorSchemeTag =
		colorScheme === 'light-dark' ? '<meta name="color-scheme" content="light dark" />' : '';

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="referrer" content="no-referrer" />
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(PREVIEW_CSP)}" />
${colorSchemeTag}
<style>
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 2rem;
  font-family: Inter, "Segoe UI", sans-serif;
  background: #f8fafc;
  color: #0f172a;
}

.pending-card {
  width: min(32rem, 100%);
  border-radius: 1rem;
  border: 1px solid rgba(15, 23, 42, 0.08);
  background: #fff;
  padding: 1.5rem;
  box-shadow: 0 18px 50px rgba(148, 163, 184, 0.18);
  text-align: center;
}

@media (prefers-color-scheme: dark) {
  body {
    background: #020617;
    color: #e2e8f0;
  }

  .pending-card {
    border-color: rgba(148, 163, 184, 0.22);
    background: #111827;
    box-shadow: 0 18px 50px rgba(2, 6, 23, 0.45);
  }
}
</style>
</head>
<body>
  <main class="pending-card">
    <p>Preparing preview...</p>
  </main>
</body>
</html>`;
}

export function getSuggestedLanguageTags(languages: readonly string[]) {
	const bestByBaseName = new Map<string, string>();
	const keyOrder: string[] = [];

	for (const candidate of ['en', ...languages]) {
		const trimmed = candidate.trim();

		if (!trimmed) {
			continue;
		}

		let baseName = trimmed;

		try {
			baseName = new Intl.Locale(trimmed).minimize().baseName || trimmed;
		} catch {
			baseName = trimmed;
		}

		const current = bestByBaseName.get(baseName);

		if (!current) {
			bestByBaseName.set(baseName, trimmed);
			keyOrder.push(baseName);
			continue;
		}

		if (trimmed.length < current.length || (trimmed.length === current.length && trimmed < current)) {
			bestByBaseName.set(baseName, trimmed);
		}
	}

	return keyOrder.map((key) => bestByBaseName.get(key) ?? key);
}

export async function buildPreviewRender(state: PlaygroundState): Promise<PreviewRender> {
	const collector = createIssueCollector();
	const renderedMarkup = await renderMarkup(state.documents.markup, state.settings.markupLanguage);

	if (!renderedMarkup.ok) {
		collector.add(renderedMarkup.message, 'error');
		return {
			document: buildErrorDocument(renderedMarkup.message, state.settings.colorScheme),
			issues: collector.issues,
		};
	}

	const normalizedHtml = normalizeRenderedHtml(renderedMarkup.html);
	const safeBodyHtml = sanitizeBodyHtml(normalizedHtml, collector.add);
	const safeHeadTags = sanitizeHeadTags(state.settings.headTags, collector.add);
	const safeHtmlAttributes = sanitizeHtmlAttributes(
		state.settings.htmlAttributes,
		state.settings.lang || 'en',
		collector.add,
	);
	const externalCssLinks = buildExternalCssLinks(state.settings.externalCss, collector.add);

	return {
		document: buildPreviewDocument(
			state,
			safeBodyHtml,
			safeHeadTags,
			safeHtmlAttributes,
			externalCssLinks,
		),
		issues: collector.issues,
	};
}

export function createInitialPreviewRender(state: PlaygroundState): PreviewRender {
	const collector = createIssueCollector();
	const safeHeadTags = sanitizeHeadTags(state.settings.headTags, collector.add);
	const safeHtmlAttributes = sanitizeHtmlAttributes(
		state.settings.htmlAttributes,
		state.settings.lang || 'en',
		collector.add,
	);
	const externalCssLinks = buildExternalCssLinks(state.settings.externalCss, collector.add);

	return {
		document: buildPreviewDocument(state, '', safeHeadTags, safeHtmlAttributes, externalCssLinks),
		issues: collector.issues,
	};
}

export function createPendingPreviewRender(colorScheme: PreviewColorScheme): PreviewRender {
	return {
		document: buildPendingDocument(colorScheme),
		issues: [],
	};
}

export function createPreviewFailureRender(
	colorScheme: PreviewColorScheme,
	message: string,
): PreviewRender {
	return {
		document: buildErrorDocument(message, colorScheme),
		issues: [
			{
				id: 'preview-error',
				message,
				severity: 'error',
			},
		],
	};
}

export function createPreviewScheduler(
	build: (state: PlaygroundState) => Promise<PreviewRender> = buildPreviewRender,
) {
	let requestNumber = 0;

	return {
		async run(state: PlaygroundState) {
			const currentRequest = ++requestNumber;
			try {
				const result = await build(state);

				return currentRequest === requestNumber ? result : null;
			} catch (error) {
				if (currentRequest !== requestNumber) {
					return null;
				}

				throw error;
			}
		},
	};
}
