import type { IpcMainInvokeEvent } from 'electron';

export interface AiEvent {
  jobId: string;
  type: 'progress' | 'done' | 'cancelled' | 'error';
  percent?: number;
  message?: string;
}

export interface SavePick {
  title: string;
  defaultName: string;
  filters: { name: string; extensions: string[] }[];
}

/** Main-process services the offline tools are allowed to use. */
export interface AiHost {
  assertTrusted(event: IpcMainInvokeEvent): void;
  assertReadable(filePath: string): Promise<string>;
  assertWritable(filePath: string): string;
  assertRegular(filePath: string): Promise<void>;
  grantRead(filePath: string): void;
  persistGrants(): void;
  ffmpegPath(): Promise<string>;
  userData(): string;
  platform: string;
  arch: string;
  pickSave(event: IpcMainInvokeEvent, options: SavePick): Promise<string | null>;
  send(event: IpcMainInvokeEvent, payload: AiEvent): void;
}
