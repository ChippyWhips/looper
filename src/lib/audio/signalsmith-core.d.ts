declare module 'virtual:signalsmith-core' {
	/** Emscripten factory for the Signalsmith Stretch WASM core. */
	const createModule: (options?: Record<string, unknown>) => Promise<unknown>;
	export default createModule;
}
