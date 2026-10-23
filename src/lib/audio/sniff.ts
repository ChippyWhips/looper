/**
 * Native sample rate from a file's header, so the AudioContext can run at that rate and
 * decoding never resamples. Returns null when the format is unknown.
 */
export function sniffSampleRate(bytes: Uint8Array): number | null {
	const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const str = (o: number, n: number) => String.fromCharCode(...bytes.subarray(o, o + n));
	if (bytes.length < 12) return null;

	if (str(0, 4) === 'RIFF' && str(8, 4) === 'WAVE') {
		let o = 12;
		while (o + 8 <= bytes.length) {
			const id = str(o, 4);
			const size = v.getUint32(o + 4, true);
			if (id === 'fmt ' && o + 16 <= bytes.length) return v.getUint32(o + 12, true);
			o += 8 + size + (size & 1);
		}
		return null;
	}

	if (str(0, 4) === 'FORM' && (str(8, 4) === 'AIFF' || str(8, 4) === 'AIFC')) {
		let o = 12;
		while (o + 8 <= bytes.length) {
			const id = str(o, 4);
			const size = v.getUint32(o + 4, false);
			if (id === 'COMM' && o + 26 <= bytes.length) return extended80(v, o + 16);
			o += 8 + size + (size & 1);
		}
		return null;
	}

	if (str(0, 4) === 'fLaC' && bytes.length >= 21) {
		// STREAMINFO: sample rate is the first 20 bits at byte 18.
		return (bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4);
	}

	if (str(4, 4) === 'ftyp') {
		for (let o = 8; o + 32 < bytes.length; o++) {
			if (bytes[o] === 0x6d && str(o, 4) === 'mp4a') return v.getUint16(o + 28, false);
		}
		return null;
	}

	if (str(0, 4) === 'OggS') {
		if (bytes.length > 40 && str(28, 8) === 'OpusHead') return 48000;
		for (let o = 0; o + 16 < Math.min(bytes.length, 512); o++) {
			if (bytes[o] === 1 && str(o + 1, 6) === 'vorbis') return v.getUint32(o + 12, true);
		}
		return null;
	}

	return mp3Rate(bytes);
}

function extended80(v: DataView, o: number): number {
	const exp = (v.getUint16(o, false) & 0x7fff) - 16383;
	const hi = v.getUint32(o + 2, false);
	return Math.round(hi * Math.pow(2, exp - 31));
}

const MPEG_RATES: Record<number, number[]> = {
	3: [44100, 48000, 32000],
	2: [22050, 24000, 16000],
	0: [11025, 12000, 8000]
};

function mp3Rate(bytes: Uint8Array): number | null {
	let o = 0;
	if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
		const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
		o = 10 + size;
	}
	const end = Math.min(bytes.length - 4, o + 65536);
	for (; o < end; o++) {
		if (bytes[o] !== 0xff || (bytes[o + 1] & 0xe0) !== 0xe0) continue;
		const version = (bytes[o + 1] >> 3) & 3;
		const layer = (bytes[o + 1] >> 1) & 3;
		const rateIdx = (bytes[o + 2] >> 2) & 3;
		const bitrate = bytes[o + 2] >> 4;
		if (version === 1 || layer === 0 || rateIdx === 3 || bitrate === 15 || bitrate === 0) continue;
		return MPEG_RATES[version][rateIdx];
	}
	return null;
}
