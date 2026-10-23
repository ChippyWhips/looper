import type { App } from '../state/app.svelte';

function isTextField(t: EventTarget | null): boolean {
	if (!(t instanceof HTMLElement)) return false;
	return (
		t.isContentEditable ||
		t.tagName === 'INPUT' ||
		t.tagName === 'TEXTAREA' ||
		t.tagName === 'SELECT'
	);
}

/** Global shortcuts; suspended while a text field has focus. Returns true if handled. */
export function handleKey(app: App, e: KeyboardEvent, openPicker: () => void): boolean {
	if (isTextField(e.target)) return false;
	const mod = e.metaKey || e.ctrlKey;
	if (mod && e.key.toLowerCase() === 'o') {
		openPicker();
		return true;
	}
	if (mod) return false;
	const k = e.key;
	switch (k) {
		case ' ':
			app.togglePlay();
			return true;
		case 'Enter':
			app.jumpToStart();
			return true;
		case '=':
		case '+':
			app.zoomStep(2);
			return true;
		case '-':
		case '_':
			app.zoomStep(0.5);
			return true;
		case '0':
			app.zoomFit();
			return true;
		case 'f':
		case 'F':
			app.followPlayhead();
			return true;
		case 'z':
		case 'Z':
			app.zoomToLoop();
			return true;
		case 'c':
		case 'C':
			app.toggleCountIn();
			return true;
		case ',':
		case '<':
			app.speedStep(-1, e.shiftKey);
			return true;
		case '.':
		case '>':
			app.speedStep(1, e.shiftKey);
			return true;
		case '?':
			app.view.shortcutsOpen = !app.view.shortcutsOpen;
			return true;
		case 'Escape':
			if (app.view.shortcutsOpen) app.view.shortcutsOpen = false;
			else if (app.view.recentOpen) app.view.recentOpen = false;
			else app.loop.selected = null;
			return true;
		case 'ArrowLeft':
		case 'ArrowRight': {
			const dir = k === 'ArrowLeft' ? -1 : 1;
			app.arrow(dir, e.shiftKey, e.altKey);
			return true;
		}
	}
	return app.loopKey(e);
}
