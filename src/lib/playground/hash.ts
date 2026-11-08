import {
	compressToEncodedURIComponent,
	decompressFromEncodedURIComponent,
} from 'lz-string';

import type {
	DecodeHashResult,
	MarkupLanguage,
	PlaygroundState,
	PreviewColorScheme,
	SerializedPlaygroundState,
} from './types';

const MAX_HASH_LENGTH = 100_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function isMarkupLanguage(value: unknown): value is MarkupLanguage {
	return value === 'html' || value === 'markdown' || value === 'pug';
}

function isPreviewColorScheme(value: unknown): value is PreviewColorScheme {
	return value === 'light' || value === 'light-dark';
}

function isString(value: unknown): value is string {
	return typeof value === 'string';
}

function parseSerializedState(value: unknown): PlaygroundState | null {
	if (!isRecord(value) || value.v !== 1) {
		return null;
	}

	const documents = value.documents;
	const settings = value.settings;

	if (!isRecord(documents) || !isRecord(settings)) {
		return null;
	}

	const markup = documents.markup;
	const styles = documents.styles;
	const scripts = documents.scripts;

	if (!isRecord(markup) || !isRecord(styles)) {
		return null;
	}

	if (
		!isString(markup.code) ||
		!isMarkupLanguage(markup.language) ||
		!isString(styles.code) ||
		!isString(styles.externalCss) ||
		!isString(settings.lang) ||
		!isPreviewColorScheme(settings.colorScheme) ||
		!isString(settings.headTags) ||
		!isString(settings.htmlAttributes)
	) {
		return null;
	}

	return {
		documents: {
			markup: markup.code,
			styles: styles.code,
			scripts: isRecord(scripts) && isString(scripts.code) ? scripts.code : '',
		},
		settings: {
			externalCss: styles.externalCss,
			lang: settings.lang,
			markupLanguage: markup.language,
			colorScheme: settings.colorScheme,
			headTags: settings.headTags,
			htmlAttributes: settings.htmlAttributes,
		},
	};
}

export function encodeStateToHash(state: PlaygroundState): string {
	const payload: SerializedPlaygroundState = {
		v: 1,
		documents: {
			markup: {
				code: state.documents.markup,
				language: state.settings.markupLanguage,
			},
			styles: {
				code: state.documents.styles,
				externalCss: state.settings.externalCss,
			},
			scripts: {
				code: state.documents.scripts,
			},
		},
		settings: {
			lang: state.settings.lang,
			colorScheme: state.settings.colorScheme,
			headTags: state.settings.headTags,
			htmlAttributes: state.settings.htmlAttributes,
		},
	};

	return `#${compressToEncodedURIComponent(JSON.stringify(payload))}`;
}

export function decodeStateFromHash(hash: string): DecodeHashResult {
	if (!hash || hash === '#') {
		return { state: null };
	}

	const encoded = hash.startsWith('#') ? hash.slice(1) : hash;

	if (encoded.length > MAX_HASH_LENGTH) {
		return {
			state: null,
			error: 'The shared URL is too large to decode safely.',
		};
	}

	const decoded = decompressFromEncodedURIComponent(encoded);

	if (!decoded) {
		return {
			state: null,
			error: 'The shared URL could not be decoded.',
		};
	}

	try {
		const parsed = JSON.parse(decoded);
		const state = parseSerializedState(parsed);

		if (!state) {
			return {
				state: null,
				error: 'The shared URL format is not supported.',
			};
		}

		return { state };
	} catch {
		return {
			state: null,
			error: 'The shared URL contains invalid JSON data.',
		};
	}
}
