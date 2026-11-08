import type { MarkupLanguage, PlaygroundState, PreviewColorScheme } from './types';

export const DEFAULT_PLAYGROUND_STATE: PlaygroundState = {
	documents: {
		markup: '',
		styles: '',
		scripts: '',
	},
	settings: {
		externalCss: '',
		lang: 'en',
		markupLanguage: 'html',
		colorScheme: 'light-dark',
		headTags: '',
		htmlAttributes: '',
	},
};

export const MARKUP_LANGUAGE_LABELS: Record<MarkupLanguage, string> = {
	html: 'HTML',
	markdown: 'Markdown',
	pug: 'Pug',
};

export const COLOR_SCHEME_LABELS: Record<PreviewColorScheme, string> = {
	light: 'Light only',
	'light-dark': 'Light + dark',
};
