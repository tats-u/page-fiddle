export const MARKUP_LANGUAGE_OPTIONS = ['html', 'markdown', 'pug'] as const;
export type MarkupLanguage = (typeof MARKUP_LANGUAGE_OPTIONS)[number];

export const PREVIEW_COLOR_SCHEME_OPTIONS = ['light', 'light-dark'] as const;
export type PreviewColorScheme = (typeof PREVIEW_COLOR_SCHEME_OPTIONS)[number];

export interface PlaygroundDocuments {
	markup: string;
	styles: string;
	scripts: string;
}

export interface PlaygroundSettings {
	externalCss: string;
	lang: string;
	markupLanguage: MarkupLanguage;
	colorScheme: PreviewColorScheme;
	headTags: string;
	htmlAttributes: string;
}

export interface PlaygroundState {
	documents: PlaygroundDocuments;
	settings: PlaygroundSettings;
}

export interface SerializedPlaygroundState {
	v: 1;
	documents: {
		markup: {
			code: string;
			language: MarkupLanguage;
		};
		styles: {
			code: string;
			externalCss: string;
		};
		scripts: {
			code: string;
		};
	};
	settings: {
		lang: string;
		colorScheme: PreviewColorScheme;
		headTags: string;
		htmlAttributes: string;
	};
}

export type PreviewIssueSeverity = 'warning' | 'error';

export interface PreviewIssue {
	id: string;
	message: string;
	severity: PreviewIssueSeverity;
}

export interface PreviewRender {
	document: string;
	issues: PreviewIssue[];
}

export interface DecodeHashResult {
	state: PlaygroundState | null;
	error?: string;
}
