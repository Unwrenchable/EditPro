import { createContext, useContext, type RefObject } from 'react';
import type { PhotoEditorApi } from '../hooks/usePhotoEditor';
import type { ProjectSessionApi } from '../hooks/useProjectSession';
import type { VideoEditorApi } from '../hooks/useVideoEditor';

export interface EditorSessionValue extends ProjectSessionApi {
  photo: PhotoEditorApi;
  video: VideoEditorApi;
  videoRef: RefObject<HTMLVideoElement | null>;
}

export const EditorSessionContext = createContext<EditorSessionValue | null>(null);

export function useEditorSession(): EditorSessionValue {
  const value = useContext(EditorSessionContext);
  if (!value) {
    throw new Error('useEditorSession must be used within EditorSessionProvider');
  }
  return value;
}
