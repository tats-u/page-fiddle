import pugBrowserScriptUrl from '@plotdb/pug-browser/pug.full.min.js?url';

interface PugBrowserRenderer {
	render(source: string, options?: { doctype?: string }): string;
}

interface BrowserRequire {
	(moduleName: string): unknown;
}

declare global {
	interface Window {
		pug?: PugBrowserRenderer;
		require?: BrowserRequire;
	}
}

let pugRendererPromise: Promise<PugBrowserRenderer> | undefined;

function getLoadedPugRenderer() {
	if (typeof window === 'undefined') {
		return null;
	}

	if (window.pug && typeof window.pug.render === 'function') {
		return window.pug;
	}

	const requireFunction = window.require;

	if (typeof requireFunction !== 'function') {
		return null;
	}

	try {
		const module = requireFunction('pug') as { render?: unknown } | undefined;

		if (module && typeof module.render === 'function') {
			return module as PugBrowserRenderer;
		}
	} catch {
		return null;
	}

	return null;
}

function loadPugBrowserScript() {
	return new Promise<void>((resolve, reject) => {
		const existingScript = document.querySelector<HTMLScriptElement>(
			'script[data-page-fiddle-pug-browser]',
		);

		const finalize = () => resolve();
		const fail = () => reject(new Error('Could not load the browser Pug bundle.'));

		if (existingScript) {
			if (existingScript.dataset.status === 'ready') {
				resolve();
				return;
			}

			if (existingScript.dataset.status === 'error') {
				existingScript.remove();
			} else {
				existingScript.addEventListener('load', finalize, { once: true });
				existingScript.addEventListener('error', fail, { once: true });
				return;
			}
		}

		const script = document.createElement('script');
		script.async = true;
		script.dataset.pageFiddlePugBrowser = 'true';
		script.dataset.status = 'loading';
		script.src = pugBrowserScriptUrl;
		script.addEventListener(
			'load',
			() => {
				script.dataset.status = 'ready';
				resolve();
			},
			{ once: true },
		);
		script.addEventListener(
			'error',
			() => {
				script.dataset.status = 'error';
				reject(new Error('Could not load the browser Pug bundle.'));
			},
			{ once: true },
		);
		document.head.append(script);
	});
}

export function loadPugBrowserRenderer() {
	const loadedRenderer = getLoadedPugRenderer();

	if (loadedRenderer) {
		return Promise.resolve(loadedRenderer);
	}

	pugRendererPromise ??= loadPugBrowserScript()
		.then(() => {
			const renderer = getLoadedPugRenderer();

			if (!renderer) {
				throw new Error(
					'Loaded the browser Pug bundle, but the renderer was unavailable.',
				);
			}

			return renderer;
		})
		.catch((error) => {
			pugRendererPromise = undefined;
			throw error;
		});

	return pugRendererPromise;
}
