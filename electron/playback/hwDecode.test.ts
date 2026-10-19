import { describe, expect, it } from 'vitest';
import { applyHardwareDecodeSwitches, hardwareDecodeFeatures, summarizeDecodeStatus } from './hwDecode.js';

describe('hardware decode', () => {
  it('enables the platform decoder for HEVC and Linux VAAPI', () => {
    expect(hardwareDecodeFeatures('darwin')).toEqual(['PlatformHEVCDecoderSupport']);
    expect(hardwareDecodeFeatures('win32')).toContain('D3D11VideoDecoder');
    expect(hardwareDecodeFeatures('linux')).toEqual(
      expect.arrayContaining(['PlatformHEVCDecoderSupport', 'VaapiVideoDecoder', 'VaapiIgnoreDriverChecks']),
    );
  });

  it('applies the switches once, before the GPU process starts', () => {
    const calls: Array<[string, string | undefined]> = [];
    applyHardwareDecodeSwitches(
      {
        appendSwitch(key, value) {
          calls.push([key, value]);
        },
      },
      'linux',
    );
    expect(calls.map((call) => call[0])).toEqual([
      'ignore-gpu-blocklist',
      'enable-gpu-rasterization',
      'enable-zero-copy',
      'enable-features',
    ]);
    expect(calls[3]?.[1]).toContain('VaapiVideoDecoder');
    expect(calls[3]?.[1]).not.toContain('ignore-certificate');
  });

  it('describes the GPU video-decode status', () => {
    expect(summarizeDecodeStatus('enabled').hardware).toBe(true);
    expect(summarizeDecodeStatus('enabled_readback').label).toBe('Hardware decode on');
    expect(summarizeDecodeStatus('disabled_software')).toEqual({ hardware: false, label: 'Software decode' });
    expect(summarizeDecodeStatus(undefined).label).toBe('Hardware decode unavailable');
  });
});
