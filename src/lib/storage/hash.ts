/** Lower-case hex SHA-256 of the bytes. */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
	const d = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
	return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
