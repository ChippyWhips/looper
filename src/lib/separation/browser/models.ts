import type { SeparationModel } from '../types';

/** Weights published for demucs-rs (from its `get_model_registry()`), safetensors format. */
export const MODEL_FILES: Record<
	SeparationModel,
	{ url: string; sizeMb: number; stems: string[] }
> = {
	htdemucs_6s: {
		url: 'https://huggingface.co/set-soft/audio_separation/resolve/main/Demucs/htdemucs_6s.safetensors',
		sizeMb: 84,
		stems: ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano']
	},
	htdemucs_ft: {
		url: 'https://huggingface.co/set-soft/audio_separation/resolve/main/Demucs/htdemucs_ft.safetensors',
		sizeMb: 333,
		stems: ['drums', 'bass', 'other', 'vocals']
	}
};
