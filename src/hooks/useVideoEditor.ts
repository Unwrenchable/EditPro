import { useState, useCallback, useRef } from 'react';
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
};

export function useVideoEditor() {
  const [state, setState] = useState<VideoEditorState>(initialState);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const loadVideo = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    setState({
      ...initialState,
      file,
      videoUrl: url,
      trimEnd: 0,
    });
  }, []);

  const setVideoRef = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
  }, []);

  const onLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setState((prev) => ({
      ...prev,
      duration: video.duration,
      trimEnd: video.duration,
    }));
  }, []);

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setState((prev) => {
      // Auto-stop at trim end
      if (video.currentTime >= prev.trimEnd) {
        video.pause();
        video.currentTime = prev.trimStart;
        return { ...prev, currentTime: prev.trimStart, isPlaying: false };
      }
      return { ...prev, currentTime: video.currentTime };
    });
  }, []);

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.currentTime >= state.trimEnd) {
      video.currentTime = state.trimStart;
    }
    void video.play();
    setState((prev) => ({ ...prev, isPlaying: true }));
  }, [state.trimEnd, state.trimStart]);

  const pause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setState((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  const togglePlay = useCallback(() => {
    if (state.isPlaying) {
      pause();
    } else {
      play();
    }
  }, [state.isPlaying, play, pause]);

  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    const clamped = clamp(time, 0, video.duration || 0);
    video.currentTime = clamped;
    setState((prev) => ({ ...prev, currentTime: clamped }));
  }, []);

  const setTrimStart = useCallback(
    (value: number) => {
      const clamped = clamp(value, 0, state.trimEnd - 0.1);
      setState((prev) => ({ ...prev, trimStart: clamped }));
      const video = videoRef.current;
      if (video && video.currentTime < clamped) {
        video.currentTime = clamped;
      }
    },
    [state.trimEnd]
  );

  const setTrimEnd = useCallback(
    (value: number) => {
      const clamped = clamp(value, state.trimStart + 0.1, state.duration);
      setState((prev) => ({ ...prev, trimEnd: clamped }));
    },
    [state.trimStart, state.duration]
  );

  const setPlaybackRate = useCallback((rate: number) => {
    const video = videoRef.current;
    if (video) video.playbackRate = rate;
    setState((prev) => ({ ...prev, playbackRate: rate }));
  }, []);

  const setVolume = useCallback((vol: number) => {
    const video = videoRef.current;
    const clamped = clamp(vol, 0, 1);
    if (video) video.volume = clamped;
    setState((prev) => ({ ...prev, volume: clamped, isMuted: clamped === 0 }));
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const newMuted = !state.isMuted;
    video.muted = newMuted;
    setState((prev) => ({ ...prev, isMuted: newMuted }));
  }, [state.isMuted]);

  const updateVideoAdjustment = useCallback(
    (key: 'brightness' | 'contrast' | 'saturation', value: number) => {
      setState((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const resetVideo = useCallback(() => {
    if (state.videoUrl) {
      URL.revokeObjectURL(state.videoUrl);
    }
    setState(initialState);
    videoRef.current = null;
  }, [state.videoUrl]);

  return {
    state,
    videoRef,
    setVideoRef,
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
    loadVideo,
  };
}
