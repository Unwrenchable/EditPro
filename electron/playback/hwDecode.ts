/**
 * Chromium decodes `<video>` on the GPU only when the codec has a platform
 * decoder and the GPU blocklist has not forced software decode.
 * H.264 proxies hit that path on macOS (VideoToolbox), Windows (D3D11), and
 * Linux (VAAPI). HEVC camera originals need the platform HEVC feature as well.
 */

export interface CommandLineSwitches {
  appendSwitch(key: string, value?: string): void;
}

export function hardwareDecodeFeatures(platform: NodeJS.Platform | string): string[] {
  const features = ['PlatformHEVCDecoderSupport'];
  if (platform === 'linux') {
    features.push('VaapiVideoDecoder', 'VaapiIgnoreDriverChecks');
  } else if (platform === 'win32') {
    features.push('D3D11VideoDecoder');
  }
  return features;
}

/** Call before `app.whenReady`. Switches are ignored once the GPU process starts. */
export function applyHardwareDecodeSwitches(
  commandLine: CommandLineSwitches,
  platform: NodeJS.Platform | string,
): void {
  commandLine.appendSwitch('ignore-gpu-blocklist');
  commandLine.appendSwitch('enable-gpu-rasterization');
  commandLine.appendSwitch('enable-zero-copy');
  commandLine.appendSwitch('enable-features', hardwareDecodeFeatures(platform).join(','));
}

export interface DecodeStatusSummary {
  hardware: boolean;
  label: string;
}

/** Map `app.getGPUFeatureStatus().video_decode` to a short monitor label. */
export function summarizeDecodeStatus(videoDecode: string | null | undefined): DecodeStatusSummary {
  if (videoDecode === 'enabled' || videoDecode === 'enabled_readback') {
    return { hardware: true, label: 'Hardware decode on' };
  }
  if (
    videoDecode === 'disabled_software' ||
    videoDecode === 'unavailable_software' ||
    videoDecode === 'software'
  ) {
    return { hardware: false, label: 'Software decode' };
  }
  return { hardware: false, label: 'Hardware decode unavailable' };
}
