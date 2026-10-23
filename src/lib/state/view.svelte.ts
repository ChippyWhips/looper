import { WaveView } from '../ui/waveform/viewport';

/** View state. The viewport itself is plain (redrawn on rAF); only overlay state is reactive. */
export class ViewState {
	readonly wave = new WaveView();
	shortcutsOpen = $state(false);
	recentOpen = $state(false);
	dropActive = $state(false);

	get viewport() {
		return this.wave.viewport;
	}
}
