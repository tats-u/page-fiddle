import type { Extension } from '@codemirror/state';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import {
	createEffect,
	createMemo,
	createSignal,
	For,
	onCleanup,
	onMount,
	Show,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

import CodeEditor from './CodeEditor';
import {
	COLOR_SCHEME_LABELS,
	DEFAULT_PLAYGROUND_STATE,
	MARKUP_LANGUAGE_LABELS,
} from '../lib/playground/defaults';
import { decodeStateFromHash, encodeStateToHash } from '../lib/playground/hash';
import {
	buildPreviewRender,
	createPreviewFailureRender,
	createInitialPreviewRender,
	createPreviewScheduler,
	getSuggestedLanguageTags,
} from '../lib/playground/preview';
import {
	MARKUP_LANGUAGE_OPTIONS,
	PREVIEW_COLOR_SCHEME_OPTIONS,
	type MarkupLanguage,
	type PlaygroundState,
	type PreviewRender,
	type PreviewIssueSeverity,
} from '../lib/playground/types';

type NoticeTone = 'neutral' | 'success' | 'error';
type ResizablePane = 'editors' | 'workspace';

const HTML_MARKUP_LANGUAGE = html({
	autoCloseTags: true,
	matchClosingTags: true,
});
const CSS_LANGUAGE = css();
const SPLIT_LAYOUT_QUERY = '(min-width: 1080px) and (min-height: 760px)';
const MIN_EDITOR_SPLIT = 0.28;
const MAX_EDITOR_SPLIT = 0.72;
const MIN_WORKSPACE_SPLIT = 0.32;
const MAX_WORKSPACE_SPLIT = 0.72;

const MARKUP_LANGUAGE_EXTENSION_CACHE = new Map<MarkupLanguage, Promise<Extension>>();
const MARKUP_LANGUAGE_LOADERS: Record<MarkupLanguage, () => Promise<Extension>> = {
	html: async () => HTML_MARKUP_LANGUAGE,
	markdown: async () => {
		const { markdown } = await import('@codemirror/lang-markdown');
		return markdown();
	},
	pug: async () => {
		const [{ StreamLanguage }, { pug }] = await Promise.all([
			import('@codemirror/language'),
			import('@codemirror/legacy-modes/mode/pug'),
		]);

		return StreamLanguage.define(pug);
	},
};

function loadMarkupLanguageExtension(language: MarkupLanguage) {
	let extensionPromise = MARKUP_LANGUAGE_EXTENSION_CACHE.get(language);

	if (!extensionPromise) {
		extensionPromise = MARKUP_LANGUAGE_LOADERS[language]();
		MARKUP_LANGUAGE_EXTENSION_CACHE.set(language, extensionPromise);
	}

	return extensionPromise;
}

function cloneState(state: PlaygroundState): PlaygroundState {
	return {
		documents: {
			markup: state.documents.markup,
			styles: state.documents.styles,
			scripts: state.documents.scripts,
		},
		settings: {
			externalCss: state.settings.externalCss,
			lang: state.settings.lang,
			markupLanguage: state.settings.markupLanguage,
			colorScheme: state.settings.colorScheme,
			headTags: state.settings.headTags,
			htmlAttributes: state.settings.htmlAttributes,
		},
	};
}

function getIssueClassName(severity: PreviewIssueSeverity) {
	return severity === 'error' ? 'issue issue--error' : 'issue issue--warning';
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

export default function Playground() {
	const [state, setState] = createStore<PlaygroundState>(cloneState(DEFAULT_PLAYGROUND_STATE));
	const [prefersDark, setPrefersDark] = createSignal(false);
	const [languageSuggestions, setLanguageSuggestions] = createSignal<string[]>(['en']);
	const [noticeMessage, setNoticeMessage] = createSignal<string>('');
	const [noticeTone, setNoticeTone] = createSignal<NoticeTone>('neutral');
	const [isSplitLayout, setIsSplitLayout] = createSignal(false);
	const [isSettingsOpen, setIsSettingsOpen] = createSignal(false);
	const [isPreviewReady, setIsPreviewReady] = createSignal(false);
	const [editorSplitRatio, setEditorSplitRatio] = createSignal(0.5);
	const [workspaceSplitRatio, setWorkspaceSplitRatio] = createSignal(0.54);
	const [markupLanguageExtension, setMarkupLanguageExtension] =
		createSignal<Extension>(HTML_MARKUP_LANGUAGE);
	const [preview, setPreview] = createSignal<PreviewRender>(
		createInitialPreviewRender(DEFAULT_PLAYGROUND_STATE),
	);

	const previewScheduler = createPreviewScheduler(buildPreviewRender);
	let settingsDialog: HTMLDialogElement | undefined;
	let workspaceElement: HTMLElement | undefined;
	let editorPaneGroupElement: HTMLElement | undefined;
	let stopActiveResize: (() => void) | undefined;

	const previewInput = createMemo<PlaygroundState>(() => ({
		documents: {
			markup: state.documents.markup,
			styles: state.documents.styles,
			scripts: state.documents.scripts,
		},
		settings: {
			externalCss: state.settings.externalCss,
			lang: state.settings.lang,
			markupLanguage: state.settings.markupLanguage,
			colorScheme: state.settings.colorScheme,
			headTags: state.settings.headTags,
			htmlAttributes: state.settings.htmlAttributes,
		},
	}));
	const splitLayoutStyle = createMemo(() =>
		isSplitLayout()
			? `--editor-split: ${editorSplitRatio() * 100}%; --workspace-split: ${workspaceSplitRatio() * 100}%;`
			: undefined,
	);

	function updateNotice(message: string, tone: NoticeTone) {
		setNoticeMessage(message);
		setNoticeTone(tone);
	}

	function openSettings() {
		if (!settingsDialog || settingsDialog.open) {
			return;
		}

		settingsDialog.showModal();
		setIsSettingsOpen(true);
	}

	function closeSettings() {
		if (!settingsDialog?.open) {
			return;
		}

		settingsDialog.close();
	}

	function updateSplitRatio(kind: ResizablePane, nextValue: number) {
		if (kind === 'editors') {
			setEditorSplitRatio(clamp(nextValue, MIN_EDITOR_SPLIT, MAX_EDITOR_SPLIT));
			return;
		}

		setWorkspaceSplitRatio(clamp(nextValue, MIN_WORKSPACE_SPLIT, MAX_WORKSPACE_SPLIT));
	}

	function startResize(kind: ResizablePane, event: PointerEvent) {
		if (!isSplitLayout()) {
			return;
		}

		const container = kind === 'editors' ? editorPaneGroupElement : workspaceElement;

		if (!container) {
			return;
		}

		const rect = container.getBoundingClientRect();
		const size = kind === 'editors' ? rect.width : rect.height;

		if (size <= 0) {
			return;
		}

		event.preventDefault();
		stopActiveResize?.();

		const update = (pointerEvent: PointerEvent) => {
			const offset =
				kind === 'editors'
					? pointerEvent.clientX - rect.left
					: pointerEvent.clientY - rect.top;
			updateSplitRatio(kind, offset / size);
		};

		const stop = () => {
			window.removeEventListener('pointermove', update);
			window.removeEventListener('pointerup', stop);
			window.removeEventListener('pointercancel', stop);
			document.body.classList.remove('is-resizing');
			document.body.style.removeProperty('cursor');
			stopActiveResize = undefined;
		};

		stopActiveResize = stop;
		document.body.classList.add('is-resizing');
		document.body.style.cursor = kind === 'editors' ? 'col-resize' : 'row-resize';
		window.addEventListener('pointermove', update);
		window.addEventListener('pointerup', stop, { once: true });
		window.addEventListener('pointercancel', stop, { once: true });
	}

	function handleSeparatorKeyDown(kind: ResizablePane, event: KeyboardEvent) {
		const step = event.shiftKey ? 0.05 : 0.02;

		if (kind === 'editors') {
			if (event.key === 'ArrowLeft') {
				event.preventDefault();
				updateSplitRatio(kind, editorSplitRatio() - step);
			}

			if (event.key === 'ArrowRight') {
				event.preventDefault();
				updateSplitRatio(kind, editorSplitRatio() + step);
			}

			return;
		}

		if (event.key === 'ArrowUp') {
			event.preventDefault();
			updateSplitRatio(kind, workspaceSplitRatio() - step);
		}

		if (event.key === 'ArrowDown') {
			event.preventDefault();
			updateSplitRatio(kind, workspaceSplitRatio() + step);
		}
	}

	function applyDecodedHash(hash: string, options?: { silent?: boolean }) {
		const result = decodeStateFromHash(hash);

		if (!result.state) {
			if (result.error) {
				updateNotice(result.error, 'error');
			}

			return;
		}

		setState(reconcile(cloneState(result.state)));

		if (!options?.silent) {
			updateNotice('Loaded the shared document from the URL.', 'success');
		}
	}

	async function handleShare() {
		const hash = encodeStateToHash(previewInput());
		const shareUrl = new URL(window.location.href);
		shareUrl.hash = hash.slice(1);
		window.history.replaceState({}, '', shareUrl);

		try {
			await navigator.clipboard.writeText(shareUrl.toString());
			updateNotice('Share URL copied to the clipboard.', 'success');
		} catch (error) {
			console.error(error);
			updateNotice('Share URL generated. Copy it from the address bar.', 'neutral');
		}
	}

	onMount(() => {
		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		const splitLayoutMediaQuery = window.matchMedia(SPLIT_LAYOUT_QUERY);
		const syncTheme = () => setPrefersDark(mediaQuery.matches);
		const syncSplitLayout = () => setIsSplitLayout(splitLayoutMediaQuery.matches);
		syncTheme();
		syncSplitLayout();

		mediaQuery.addEventListener('change', syncTheme);
		splitLayoutMediaQuery.addEventListener('change', syncSplitLayout);
		onCleanup(() => {
			mediaQuery.removeEventListener('change', syncTheme);
			splitLayoutMediaQuery.removeEventListener('change', syncSplitLayout);
			stopActiveResize?.();
			document.body.classList.remove('is-resizing');
			document.body.style.removeProperty('cursor');
		});

		setLanguageSuggestions(getSuggestedLanguageTags(window.navigator.languages));

		if (window.location.hash.length > 1) {
			applyDecodedHash(window.location.hash, { silent: true });
		}

		setIsPreviewReady(true);

		const handleHashChange = () => {
			if (window.location.hash.length <= 1) {
				return;
			}

			applyDecodedHash(window.location.hash);
		};

		window.addEventListener('hashchange', handleHashChange);
		onCleanup(() => {
			window.removeEventListener('hashchange', handleHashChange);
		});
	});

	createEffect(() => {
		const language = state.settings.markupLanguage;

		void loadMarkupLanguageExtension(language)
			.then((extension) => {
				if (state.settings.markupLanguage === language) {
					setMarkupLanguageExtension(extension);
				}
			})
			.catch((error) => {
				console.error(error);
			});
	});

	createEffect(() => {
		if (!isPreviewReady()) {
			return;
		}

		const snapshot = previewInput();

		void previewScheduler
			.run(snapshot)
			.then((result) => {
				if (result) {
					setPreview(result);
				}
			})
			.catch((error) => {
				console.error(error);
				setPreview(
					createPreviewFailureRender(
						snapshot.settings.colorScheme,
						error instanceof Error ? error.message : 'Unknown preview error.',
					),
				);
			});
	});

	return (
		<div class="app-shell">
			<header class="titlebar">
				<div class="titlebar__identity">
					<h1>Web Fiddle</h1>
				</div>
				<div class="titlebar__actions">
					<Show when={noticeMessage()}>
						<p class={`notice notice--${noticeTone()}`} role="status" aria-live="polite">
							{noticeMessage()}
						</p>
					</Show>
					<button
						class="button button--ghost"
						type="button"
						aria-haspopup="dialog"
						aria-expanded={isSettingsOpen()}
						onClick={openSettings}
					>
						Settings
					</button>
					<button class="button button--primary" type="button" onClick={handleShare}>
						Share
					</button>
				</div>
			</header>

			<main
				ref={workspaceElement}
				classList={{
					workspace: true,
					'workspace--split': isSplitLayout(),
				}}
				style={splitLayoutStyle()}
			>
				<section ref={editorPaneGroupElement} class="editor-pane-group" aria-label="Editors">
					<CodeEditor
						label={`${MARKUP_LANGUAGE_LABELS[state.settings.markupLanguage]} editor`}
						value={state.documents.markup}
						language={markupLanguageExtension()}
						darkMode={prefersDark()}
						onChange={(value) => setState('documents', 'markup', value)}
					/>
					<Show when={isSplitLayout()}>
						<div
							class="splitter splitter--vertical"
							role="separator"
							tabIndex={0}
							aria-label="Resize editors"
							aria-orientation="vertical"
							aria-valuemin={MIN_EDITOR_SPLIT * 100}
							aria-valuemax={MAX_EDITOR_SPLIT * 100}
							aria-valuenow={Math.round(editorSplitRatio() * 100)}
							onPointerDown={(event) => startResize('editors', event)}
							onKeyDown={(event) => handleSeparatorKeyDown('editors', event)}
						/>
					</Show>
					<CodeEditor
						label="CSS editor"
						value={state.documents.styles}
						language={CSS_LANGUAGE}
						darkMode={prefersDark()}
						onChange={(value) => setState('documents', 'styles', value)}
					/>
				</section>

				<Show when={isSplitLayout()}>
					<div
						class="splitter splitter--horizontal"
						role="separator"
						tabIndex={0}
						aria-label="Resize preview"
						aria-orientation="horizontal"
						aria-valuemin={MIN_WORKSPACE_SPLIT * 100}
						aria-valuemax={MAX_WORKSPACE_SPLIT * 100}
						aria-valuenow={Math.round(workspaceSplitRatio() * 100)}
						onPointerDown={(event) => startResize('workspace', event)}
						onKeyDown={(event) => handleSeparatorKeyDown('workspace', event)}
					/>
				</Show>

				<section class="panel panel--preview" aria-labelledby="preview-heading">
					<div class="panel__header">
						<h2 id="preview-heading">Preview</h2>
					</div>

					<Show when={preview().issues.length > 0}>
						<div class="issues">
							<For each={preview().issues}>
								{(issue) => (
									<p class={getIssueClassName(issue.severity)}>{issue.message}</p>
								)}
							</For>
						</div>
					</Show>

					<iframe
						class="preview-frame"
						title="Preview"
						referrerpolicy="no-referrer"
						sandbox=""
						srcdoc={preview().document}
					/>
				</section>
			</main>

			<dialog
				ref={settingsDialog}
				class="settings-dialog"
				onClose={() => setIsSettingsOpen(false)}
				onClick={(event) => {
					if (event.currentTarget === event.target) {
						closeSettings();
					}
				}}
			>
				<div class="settings-dialog__surface">
					<div class="settings-dialog__header">
						<h2>Preview settings</h2>
						<button class="button button--ghost" type="button" onClick={closeSettings}>
							Close
						</button>
					</div>

					<div class="settings-grid">
						<label class="field">
							<span class="field__label">Markup language</span>
							<select
								value={state.settings.markupLanguage}
								onInput={(event) =>
									setState(
										'settings',
										'markupLanguage',
										event.currentTarget.value as MarkupLanguage,
									)
								}
							>
								<For each={MARKUP_LANGUAGE_OPTIONS}>
									{(option) => (
										<option value={option}>{MARKUP_LANGUAGE_LABELS[option]}</option>
									)}
								</For>
							</select>
						</label>

						<label class="field">
							<span class="field__label">Color scheme</span>
							<select
								value={state.settings.colorScheme}
								onInput={(event) =>
									setState(
										'settings',
										'colorScheme',
										event.currentTarget
											.value as PlaygroundState['settings']['colorScheme'],
									)
								}
							>
								<For each={PREVIEW_COLOR_SCHEME_OPTIONS}>
									{(option) => (
										<option value={option}>{COLOR_SCHEME_LABELS[option]}</option>
									)}
								</For>
							</select>
						</label>

						<label class="field field--wide">
							<span class="field__label">Page language</span>
							<input
								type="text"
								value={state.settings.lang}
								onInput={(event) =>
									setState('settings', 'lang', event.currentTarget.value)
								}
								onBlur={(event) =>
									setState('settings', 'lang', event.currentTarget.value.trim())
								}
								placeholder="en"
							/>
							<div class="field__choices" aria-label="Suggested page languages">
								<For each={languageSuggestions()}>
									{(option) => (
										<button
											classList={{
												'choice-chip': true,
												'choice-chip--active': state.settings.lang === option,
											}}
											type="button"
											onClick={() => setState('settings', 'lang', option)}
										>
											{option}
										</button>
									)}
								</For>
							</div>
						</label>

						<label class="field field--wide">
							<span class="field__label">External CSS</span>
							<textarea
								rows={3}
								value={state.settings.externalCss}
								onInput={(event) =>
									setState('settings', 'externalCss', event.currentTarget.value)
								}
								placeholder="One HTTPS URL per line"
							/>
						</label>

						<label class="field field--wide">
							<span class="field__label">Additional head tags</span>
							<textarea
								rows={4}
								value={state.settings.headTags}
								onInput={(event) =>
									setState('settings', 'headTags', event.currentTarget.value)
								}
								placeholder="<meta name=&quot;description&quot; content=&quot;...&quot;>"
							/>
						</label>

						<label class="field field--wide">
							<span class="field__label">Additional html attributes</span>
							<textarea
								rows={2}
								value={state.settings.htmlAttributes}
								onInput={(event) =>
									setState('settings', 'htmlAttributes', event.currentTarget.value)
								}
								placeholder='dir="ltr" data-theme="preview"'
							/>
						</label>
					</div>
				</div>
			</dialog>
		</div>
	);
}
