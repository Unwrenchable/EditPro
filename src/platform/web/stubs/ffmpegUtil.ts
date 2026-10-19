/** Desktop production bundles alias `@ffmpeg/util` here. */
export async function toBlobURL(url: string): Promise<string> {
  return url;
}

export async function fetchFile(input: Blob | string): Promise<Uint8Array> {
  if (typeof input === 'string') return new TextEncoder().encode(input);
  return new Uint8Array(await input.arrayBuffer());
}
