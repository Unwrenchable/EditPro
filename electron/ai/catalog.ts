/**
 * Pinned speech and matting downloads.
 * Checksums are the upstream Git LFS / release hashes. The files are not shipped in the app.
 */
export interface DownloadAsset {
  id: string;
  label: string;
  url: string;
  sha256: string;
  bytes: number;
  /** Path of the payload inside the archive, when the download is an archive. */
  entry?: string;
}

export const WHISPER_RELEASE = 'b5454';

export const WHISPER_MODELS: readonly DownloadAsset[] = [
  {
    id: 'tiny.en',
    label: 'Tiny English',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f',
    bytes: 77_704_715,
  },
  {
    id: 'base.en',
    label: 'Base English',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
    bytes: 147_964_211,
  },
  {
    id: 'small.en',
    label: 'Small English',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
    sha256: 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d',
    bytes: 487_614_201,
  },
];

export const MATTE_MODEL: DownloadAsset = {
  id: 'modnet',
  label: 'MODNet portrait matte',
  url: 'https://huggingface.co/Xenova/modnet/resolve/main/onnx/model_quantized.onnx',
  sha256: '92e49898c3e05a6d7a944fc67a8cb87c4aad754ffb6ebd949528c7d1105fee3a',
  bytes: 6_632_188,
};

interface BinaryAsset extends DownloadAsset {
  platforms: readonly string[];
}

const WHISPER_BINARIES: readonly BinaryAsset[] = [
  {
    id: 'whisper-linux-x64',
    label: 'whisper.cpp for Linux',
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_RELEASE}/whisper-bin-ubuntu-x64.tar.gz`,
    sha256: 'a72becf15d7917f990f6313867a52638b82b7f9ef237fb0c980dac56a135781c',
    bytes: 10_364_195,
    entry: 'whisper-bin-ubuntu-x64/whisper-cli',
    platforms: ['linux:x64'],
  },
  {
    id: 'whisper-linux-arm64',
    label: 'whisper.cpp for Linux ARM',
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_RELEASE}/whisper-bin-ubuntu-arm64.tar.gz`,
    sha256: '6b95ebfc60447df48e70ef00a73bdc3f41679ed2d01ef465827206a2ff325149',
    bytes: 4_608_377,
    entry: 'whisper-bin-ubuntu-arm64/whisper-cli',
    platforms: ['linux:arm64'],
  },
  {
    id: 'whisper-win-x64',
    label: 'whisper.cpp for Windows',
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_RELEASE}/whisper-bin-x64.zip`,
    sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb',
    bytes: 8_928_640,
    entry: 'Release/whisper-cli.exe',
    platforms: ['win32:x64'],
  },
  {
    id: 'whisper-win-arm64',
    label: 'whisper.cpp for Windows ARM',
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_RELEASE}/whisper-bin-win-cpu-arm64.zip`,
    sha256: '28c37e7b598c3d9bbfef94f3bd67f2ee6f12b7c86f3da5edcf5e4308d615ff6d',
    bytes: 4_371_193,
    entry: 'Release/whisper-cli.exe',
    platforms: ['win32:arm64'],
  },
];

export function whisperModel(id: string): DownloadAsset {
  const model = WHISPER_MODELS.find((item) => item.id === id);
  if (!model) throw new Error('Unknown speech model');
  return model;
}

export function whisperBinary(platform: string, arch: string): BinaryAsset | null {
  const key = `${platform}:${arch}`;
  return WHISPER_BINARIES.find((item) => item.platforms.includes(key)) ?? null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}
