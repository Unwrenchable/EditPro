import { useState, useCallback } from 'react';
import type { RefObject } from 'react';
import type {
  VideoEditorState,
  LumetriColor,
  LumetriCurves,
  AudioTrackSettings,
  AudioCategory,
  TimelineMarker,
  AutoReframeAspect,
} from '../types';
import { clamp, DEFAULT_LUMETRI, DEFAULT_AUDIO } from '../utils/videoUtils';

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
  lumetri: DEFAULT_LUMETRI,
  audio: DEFAULT_AUDIO,
  markers: [],
  autoReframe: 'original',
  timelineZoom: 1,
};

/**
 * Video editor state and operations.
 * The caller owns the videoRef and passes it in; this keeps the ref in the
 * component tree (correct React pattern) and avoids eslint react-hooks/refs
 * violations when passing hook-returned callbacks as JSX props.
 */
export function useVideoEditor(videoRef: RefObject<HTMLVideoElement | null>) {
  const [state, setState] = useState<VideoEditorState>(initialState);

  // ── File ──────────────────────────────────────────────────────────────────

  const loadVideo = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    setState({ ...initialState, file, videoUrl: url, trimEnd: 0 });
  }, []);

  // ── Playback ──────────────────────────────────────────────────────────────

  const onLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setState((prev) => ({ ...prev, duration: video.duration, trimEnd: video.duration }));
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
      if (video.currentTime >= trimEnd) video.currentTime = trimStart;
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
      if (isPlaying) pause();
      else play(trimStart, trimEnd);
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

  const stepFrame = useCallback(
    (direction: 1 | -1) => {
      const video = videoRef.current;
      if (!video) return;
      const frameDuration = 1 / 30;
      const next = clamp(video.currentTime + direction * frameDuration, 0, video.duration || 0);
      video.currentTime = next;
      setState((prev) => ({ ...prev, currentTime: next }));
    },
    [videoRef]
  );

  const skip = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      const next = clamp(video.currentTime + seconds, 0, video.duration || 0);
      video.currentTime = next;
      setState((prev) => ({ ...prev, currentTime: next }));
    },
    [videoRef]
  );

  // ── Trim ──────────────────────────────────────────────────────────────────

  const setTrimStart = useCallback(
    (value: number, trimEnd: number) => {
      const clamped = clamp(value, 0, trimEnd - 0.1);
      setState((prev) => ({ ...prev, trimStart: clamped }));
      const video = videoRef.current;
      if (video && video.currentTime < clamped) video.currentTime = clamped;
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

  const setInPoint = useCallback(
    (currentTime: number, trimEnd: number) => {
      setTrimStart(currentTime, trimEnd);
    },
    [setTrimStart]
  );

  const setOutPoint = useCallback(
    (currentTime: number, trimStart: number, duration: number) => {
      setTrimEnd(currentTime, trimStart, duration);
    },
    [setTrimEnd]
  );

  // ── Volume / Rate ─────────────────────────────────────────────────────────

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

  // ── Lumetri Color ─────────────────────────────────────────────────────────

  const updateLumetriBasic = useCallback(
    (key: keyof Omit<LumetriColor, 'curves' | 'wheels'>, value: number) => {
      setState((prev) => ({
        ...prev,
        lumetri: { ...prev.lumetri, [key]: value },
      }));
    },
    []
  );

  const updateLumetriCurves = useCallback((key: keyof LumetriCurves, value: number) => {
    setState((prev) => ({
      ...prev,
      lumetri: { ...prev.lumetri, curves: { ...prev.lumetri.curves, [key]: value } },
    }));
  }, []);

  const updateColorWheel = useCallback(
    (
      wheel: 'shadows' | 'midtones' | 'highlights',
      axis: 'x' | 'y' | 'luminance',
      value: number
    ) => {
      setState((prev) => ({
        ...prev,
        lumetri: {
          ...prev.lumetri,
          wheels: {
            ...prev.lumetri.wheels,
            [wheel]: { ...prev.lumetri.wheels[wheel], [axis]: value },
          },
        },
      }));
    },
    []
  );

  const resetLumetri = useCallback(() => {
    setState((prev) => ({ ...prev, lumetri: DEFAULT_LUMETRI }));
  }, []);

  // ── Essential Sound ───────────────────────────────────────────────────────

  const updateAudio = useCallback(
    (key: keyof AudioTrackSettings, value: number | boolean | AudioCategory) => {
      setState((prev) => ({ ...prev, audio: { ...prev.audio, [key]: value } }));
    },
    []
  );

  // ── Markers ───────────────────────────────────────────────────────────────

  const addMarker = useCallback(
    (time: number, label = '', color: TimelineMarker['color'] = 'yellow') => {
      const marker: TimelineMarker = { id: `m_${Date.now()}`, time, label, color };
      setState((prev) => ({
        ...prev,
        markers: [...prev.markers, marker].sort((a, b) => a.time - b.time),
      }));
    },
    []
  );

  const removeMarker = useCallback((id: string) => {
    setState((prev) => ({ ...prev, markers: prev.markers.filter((m) => m.id !== id) }));
  }, []);

  // ── Auto Reframe ──────────────────────────────────────────────────────────

  const setAutoReframe = useCallback((aspect: AutoReframeAspect) => {
    setState((prev) => ({ ...prev, autoReframe: aspect }));
  }, []);

  // ── Timeline zoom ─────────────────────────────────────────────────────────

  const setTimelineZoom = useCallback((zoom: number) => {
    setState((prev) => ({ ...prev, timelineZoom: clamp(zoom, 0.5, 8) }));
  }, []);

  // ── Reset ─────────────────────────────────────────────────────────────────

  const resetVideo = useCallback((videoUrl: string | null) => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setState(initialState);
  }, []);

  return {
    state,
    // File
    loadVideo,
    // Playback
    onLoadedMetadata,
    onTimeUpdate,
    play,
    pause,
    togglePlay,
    seek,
    stepFrame,
    skip,
    // Trim
    setTrimStart,
    setTrimEnd,
    setInPoint,
    setOutPoint,
    // Volume/Rate
    setPlaybackRate,
    setVolume,
    toggleMute,
    // Lumetri
    updateLumetriBasic,
    updateLumetriCurves,
    updateColorWheel,
    resetLumetri,
    // Essential Sound
    updateAudio,
    // Markers
    addMarker,
    removeMarker,
    // Auto Reframe
    setAutoReframe,
    // Timeline zoom
    setTimelineZoom,
    // Reset
    resetVideo,
  };
}
