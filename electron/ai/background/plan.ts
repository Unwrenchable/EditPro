/**
 * Portrait-matte plan. Frames are scaled, run through a local ONNX model,
 * then composited by ffmpeg. The model file itself is downloaded separately.
 */
export interface MatteSize {
  width: number;
  height: number;
}

export function matteSize(width: number, height: number): MatteSize {
  if (!(width >= 2) || !(height >= 2)) {
    throw new Error('The video frame size could not be read');
  }
  const scale = 512 / Math.min(width, height);
  const snap = (value: number) => Math.max(32, Math.min(1024, Math.round((value * scale) / 32) * 32));
  return { width: snap(width), height: snap(height) };
}

/** RGB bytes to the MODNet float tensor: (pixel / 255 - 0.5) / 0.5, NCHW. */
export function rgbToNchw(rgb: Uint8Array, width: number, height: number): Float32Array {
  const expected = width * height * 3;
  if (rgb.length < expected) throw new Error('Frame is shorter than its dimensions');
  const plane = width * height;
  const out = new Float32Array(3 * plane);
  for (let index = 0; index < plane; index += 1) {
    out[index] = (rgb[index * 3] / 255 - 0.5) / 0.5;
    out[plane + index] = (rgb[index * 3 + 1] / 255 - 0.5) / 0.5;
    out[2 * plane + index] = (rgb[index * 3 + 2] / 255 - 0.5) / 0.5;
  }
  return out;
}

export function matteToGray(values: ArrayLike<number>, length: number): Uint8Array {
  const gray = new Uint8Array(length);
  const count = Math.min(length, values.length);
  for (let index = 0; index < count; index += 1) {
    const sample = values[index];
    const clamped = sample < 0 ? 0 : sample > 1 ? 1 : sample;
    gray[index] = Math.round(clamped * 255);
  }
  return gray;
}

export function parseHexColor(value: string): string {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(value.trim());
  if (!match) throw new Error('Background color must be a 6-digit hex value');
  return match[1].toLowerCase();
}

export interface BackgroundEncode {
  filter: string;
  format: 'webm' | 'mp4';
  videoArgs: string[];
  audioArgs: string[];
}

export function backgroundEncode(options: {
  frameWidth: number;
  frameHeight: number;
  maskWidth: number;
  maskHeight: number;
  fps: number;
  mode: 'transparent' | 'color';
  color: string;
}): BackgroundEncode {
  const fps = Math.max(1, Math.min(60, options.fps));
  const mask = `[1:v]scale=${options.frameWidth}:${options.frameHeight}:flags=bilinear,format=gray[mask]`;
  if (options.mode === 'transparent') {
    return {
      filter: `${mask};[0:v]format=yuva420p[fg];[fg][mask]alphamerge[vout]`,
      format: 'webm',
      videoArgs: ['-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-b:v', '0', '-crf', '32'],
      audioArgs: ['-c:a', 'libopus', '-b:a', '128k'],
    };
  }
  const color = parseHexColor(options.color);
  return {
    filter: [
      mask,
      '[0:v][mask]alphamerge[fg]',
      `color=c=0x${color}:s=${options.frameWidth}x${options.frameHeight}:r=${fps}[bg]`,
      '[bg][fg]overlay=format=auto:shortest=1[vout]',
    ].join(';'),
    format: 'mp4',
    videoArgs: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'veryfast'],
    audioArgs: ['-c:a', 'aac', '-b:a', '192k'],
  };
}

export function extractFramesArgs(input: string, width: number, height: number, output: string): string[] {
  return [
    '-y',
    '-hide_banner',
    '-i',
    input,
    '-an',
    '-vf',
    `scale=${width}:${height}:flags=bilinear`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    output,
  ];
}

export function compositeArgs(options: {
  input: string;
  maskPath: string;
  maskWidth: number;
  maskHeight: number;
  fps: number;
  filter: string;
  videoArgs: string[];
  audioArgs: string[];
  output: string;
  dropAudio: boolean;
}): string[] {
  return [
    '-y',
    '-hide_banner',
    '-i',
    options.input,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'gray',
    '-s',
    `${options.maskWidth}x${options.maskHeight}`,
    '-r',
    String(Math.max(1, options.fps)),
    '-i',
    options.maskPath,
    '-filter_complex',
    options.filter,
    '-map',
    '[vout]',
    ...(options.dropAudio ? ['-an'] : ['-map', '0:a?', ...options.audioArgs]),
    ...options.videoArgs,
    options.output,
  ];
}
