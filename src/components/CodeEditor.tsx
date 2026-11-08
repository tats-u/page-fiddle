import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
} from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import {
	drawSelection,
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	highlightSpecialChars,
	keymap,
	lineNumbers,
} from '@codemirror/view';
import { createEffect, onCleanup, onMount } from 'solid-js';

interface CodeEditorProps {
	value: string;
	language: Extension;
	label: string;
	darkMode: boolean;
	onChange: (value: string) => void;
}

const editorBaseExtensions: Extension[] = [
	lineNumbers(),
	highlightSpecialChars(),
	history(),
	drawSelection(),
	EditorState.allowMultipleSelections.of(true),
	syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
	highlightActiveLine(),
	highlightActiveLineGutter(),
	keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
];

export default function CodeEditor(props: CodeEditorProps) {
	let container: HTMLDivElement | undefined;
	let editorView: EditorView | undefined;
	let syncingExternalValue = false;

	const languageCompartment = new Compartment();
	const themeCompartment = new Compartment();

	onMount(() => {
		if (!container) {
			return;
		}

		editorView = new EditorView({
			state: EditorState.create({
				doc: props.value,
				extensions: [
					editorBaseExtensions,
					EditorView.lineWrapping,
					languageCompartment.of(props.language),
					themeCompartment.of(props.darkMode ? oneDark : []),
					EditorView.updateListener.of((update) => {
						if (!update.docChanged || syncingExternalValue) {
							return;
						}

						props.onChange(update.state.doc.toString());
					}),
				],
			}),
			parent: container,
		});
	});

	createEffect(() => {
		if (!editorView) {
			return;
		}

		editorView.dispatch({
			effects: languageCompartment.reconfigure(props.language),
		});
	});

	createEffect(() => {
		if (!editorView) {
			return;
		}

		editorView.dispatch({
			effects: themeCompartment.reconfigure(props.darkMode ? oneDark : []),
		});
	});

	createEffect(() => {
		if (!editorView) {
			return;
		}

		const nextValue = props.value;
		const currentValue = editorView.state.doc.toString();

		if (currentValue === nextValue) {
			return;
		}

		syncingExternalValue = true;
		editorView.dispatch({
			changes: {
				from: 0,
				to: currentValue.length,
				insert: nextValue,
			},
		});
		syncingExternalValue = false;
	});

	onCleanup(() => {
		editorView?.destroy();
	});

	return (
		<div class="editor-shell">
			<div class="editor-shell__label">{props.label}</div>
			<div class="editor-shell__surface" ref={container} aria-label={props.label} />
		</div>
	);
}
