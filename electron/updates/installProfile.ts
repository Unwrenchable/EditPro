import path from 'node:path';

export interface SignatureExecResult {
  code: number;
  stdout: string;
}

/**
 * True when the running app has a valid code signature.
 * Linux packages from the release workflow are not signed.
 * A failed or timed-out check is treated as unsigned so the app offers a download instead.
 */
export async function probeSignature(options: {
  platform: NodeJS.Platform;
  exePath: string;
  execFile: (file: string, args: string[], env: NodeJS.ProcessEnv) => Promise<SignatureExecResult>;
  env?: NodeJS.ProcessEnv;
}): Promise<boolean> {
  const env = options.env ?? process.env;
  if (options.platform === 'darwin') {
    const bundle = path.resolve(options.exePath, '..', '..', '..');
    if (!bundle.endsWith('.app')) return false;
    const result = await options.execFile('codesign', ['--verify', '--deep', '--strict', bundle], env);
    return result.code === 0;
  }
  if (options.platform === 'win32') {
    const result = await options.execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', '(Get-AuthenticodeSignature -LiteralPath $env:EDITPRO_SIGN_PATH).Status'],
      { ...env, EDITPRO_SIGN_PATH: options.exePath },
    );
    return result.stdout.trim() === 'Valid';
  }
  return false;
}
