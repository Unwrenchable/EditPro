import { useRef, type ReactNode } from 'react';
import { usePhotoEditor } from '../hooks/usePhotoEditor';
import { useProjectSession } from '../hooks/useProjectSession';
import { useVideoEditor } from '../hooks/useVideoEditor';
import type { EditorMode } from '../types';
import { EditorSessionContext, type EditorSessionValue } from './editorSessionContext';

interface EditorSessionProviderProps {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  children: ReactNode;
}

export function EditorSessionProvider({ mode, onModeChange, children }: EditorSessionProviderProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const photo = usePhotoEditor();
  const video = useVideoEditor(videoRef);
  const project = useProjectSession({ mode, onModeChange, photo, video });
  const value: EditorSessionValue = { photo, video, videoRef, ...project };
  return <EditorSessionContext.Provider value={value}>{children}</EditorSessionContext.Provider>;
}
