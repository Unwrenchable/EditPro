import { useState, useCallback } from 'react';
import type { RefObject } from 'react';
import type { VideoEditorState } from '../types';
import { clamp } from '../utils/videoUtils';

const initialState: VideoEditorState = {
  file: null,
  videoUrl: null,
  duration: 0,
  currentTime: 0,
  isPlaying: false,
  trimStart: 0,
  trimEnd: 0,
  playbackRate: 1,
  volume: 1,
  isMuted: false,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  highlights: 0,
  shadows: 0,
};

/**
 * Video editor state and operations.
 * The caller owns the videoRef and passes it in; this keeps the ref in the
 * component tree (correct React pattern) and avoids eslint react-hooks/refs
 * violations when passing hook-returned callbacks as JSX props.
 */
export function useVideoEditor(videoRef: RefObject<HTMLVideoElement | null>) {
  const [state, setState] = useState<VideoEditorState>(initialState);

  const loadVideo = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    setState({
      ...initialState,
      file,
      videoUrl: url,
      trimEnd: 0,
    });
  }, []);

  const onLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setState((prev) => ({
      ...prev,
      duration: video.duration,
      trimEnd: video.duration,
    }));
  }, [videoRef]);

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setState((prev) => {
      if (video.currentTime >= prev.trimEnd) {
        video.pause();
        video.currentTime = prev.trimStart;
        return { ...prev, currentTime: prev.trimStart, isPlaying: false };
      }
      return { ...prev, currentTime: video.currentTime };
    });
  }, [videoRef]);

  const play = useCallback(
    (trimStart: number, trimEnd: number) => {
      const video = videoRef.current;
      if (!video) return;
      if (video.currentTime >= trimEnd) {
        video.currentTime = trimStart;
      }
      void video.play();
      setState((prev) => ({ ...prev, isPlaying: true }));
    },
    [videoRef]
  );

  const pause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setState((prev) => ({ ...prev, isPlaying: false }));
  }, [videoRef]);

  const togglePlay = useCallback(
    (isPlaying: boolean, trimStart: number, trimEnd: number) => {
      if (isPlaying) {
        pause();
      } else {
        play(trimStart, trimEnd);
      }
    },
    [pause, play]
  );

  const seek = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (!video) return;
      const clamped = clamp(time, 0, video.duration || 0);
      video.currentTime = clamped;
      setState((prev) => ({ ...prev, currentTime: clamped }));
    },
    [videoRef]
  );

  const setTrimStart = useCallback(
    (value: number, trimEnd: number) => {
      const clamped = clamp(value, 0, trimEnd - 0.1);
      setState((prev) => ({ ...prev, trimStart: clamped }));
      const video = videoRef.current;
      if (video && video.currentTime < clamped) {
        video.currentTime = clamped;
      }
    },
    [videoRef]
  );

  const setTrimEnd = useCallback(
    (value: number, trimStart: number, duration: number) => {
      const clamped = clamp(value, trimStart + 0.1, duration);
      setState((prev) => ({ ...prev, trimEnd: clamped }));
    },
    []
  );

  const setPlaybackRate = useCallback(
    (rate: number) => {
      const video = videoRef.current;
      if (video) video.playbackRate = rate;
      setState((prev) => ({ ...prev, playbackRate: rate }));
    },
    [videoRef]
  );

  const setVolume = useCallback(
    (vol: number) => {
      const video = videoRef.current;
      const clamped = clamp(vol, 0, 1);
      if (video) video.volume = clamped;
      setState((prev) => ({ ...prev, volume: clamped, isMuted: clamped === 0 }));
    },
    [videoRef]
  );

  const toggleMute = useCallback(
    (isMuted: boolean) => {
      const video = videoRef.current;
      if (!video) return;
      const newMuted = !isMuted;
      video.muted = newMuted;
      setState((prev) => ({ ...prev, isMuted: newMuted }));
    },
    [videoRef]
  );

  const updateVideoAdjustment = useCallback(
    (
      key: 'brightness' | 'contrast' | 'saturation' | 'temperature' | 'highlights' | 'shadows',
      value: number
    ) => {
      setState((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const resetVideo = useCallback(
    (videoUrl: string | null) => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setState(initialState);
    },
    []
  );

  return {
    state,
    loadVideo,
    onLoadedMetadata,
    onTimeUpdate,
    play,
    pause,
    togglePlay,
    seek,
    setTrimStart,
    setTrimEnd,
    setPlaybackRate,
    setVolume,
    toggleMute,
    updateVideoAdjustment,
    resetVideo,
  };
}
