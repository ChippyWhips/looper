# demucs-wasm (vendored)

Built from [demucs-rs](https://github.com/nikhilunni/demucs-rs) (Apache-2.0, see LICENSE) at tag `v0.3.5`, commit `805d6f72ede20282832ac78c634e8767716c0b21`: the `demucs-wasm` crate compiled for `wasm32-unknown-unknown` (release) and bound with `wasm-bindgen 0.2.108 --target web`. Not edited.

Rebuild with `scripts/build-demucs.sh` (needs rustup with the `wasm32-unknown-unknown` target and wasm-bindgen-cli 0.2.108).

Only `src/lib/separation/browser/` may import this directory.
