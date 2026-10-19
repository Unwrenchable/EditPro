/** Desktop production bundles alias these packages to this file. */
export class FFmpeg {
  async load(): Promise<void> {
    throw new Error('ffmpeg.wasm is omitted from the desktop bundle. Browser builds load it.');
  }

  async writeFile(): Promise<void> {
    throw new Error('ffmpeg.wasm is omitted from the desktop bundle.');
  }

  async readFile(): Promise<Uint8Array> {
    throw new Error('ffmpeg.wasm is omitted from the desktop bundle.');
  }

  async exec(): Promise<number> {
    throw new Error('ffmpeg.wasm is omitted from the desktop bundle.');
  }

  terminate(): void {}

  on(): void {}
}
