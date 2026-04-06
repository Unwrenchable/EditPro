import { useState, useCallback } from 'react';
import type { RefObject } from 'react';
import type {
  VideoEditorState,
  LumetriColor,
  LumetriCurves,
  AudioTrackSettings,
  AudioCategory,
  TimelineMarker,
  TimelineTrack,
  TimelineClip,
  TrackType,
  AutoReframeAspect,
} from '../types';
import { clamp, DEFAULT_LUMETRI, DEFAULT_AUDIO } from '../utils/videoUtils';

const DEFAULT_TRACKS: TimelineTrack[] = [
  { id: 'v1', type: 'video', name: 'V1', muted: false, locked: false },
  { id: 'a1', type: 'audio', name: 'A1', muted: false, locked: false },
];

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
  tracks: DEFAULT_TRACKS,
  clips: [],
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

  // ── Multi-track Timeline ──────────────────────────────────────────────────

  const addTrack = useCallback((type: TrackType) => {
    setState((prev) => {
      const typeCount = prev.tracks.filter((t) => t.type === type).length + 1;
      const prefix = type === 'video' ? 'V' : 'A';
      const id = `${prefix.toLowerCase()}${typeCount}_${Date.now()}`;
      const track: TimelineTrack = {
        id,
        type,
        name: `${prefix}${typeCount}`,
        muted: false,
        locked: false,
      };
      return { ...prev, tracks: [...prev.tracks, track] };
    });
  }, []);

  const setTrackMuted = useCallback((trackId: string, muted: boolean) => {
    setState((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => (t.id === trackId ? { ...t, muted } : t)),
    }));
  }, []);

  const setTrackLocked = useCallback((trackId: string, locked: boolean) => {
    setState((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => (t.id === trackId ? { ...t, locked } : t)),
    }));
  }, []);

  const removeTrack = useCallback((trackId: string) => {
    setState((prev) => ({
      ...prev,
      tracks: prev.tracks.filter((t) => t.id !== trackId),
      clips: prev.clips.filter((c) => c.trackId !== trackId),
    }));
  }, []);

  const addClip = useCallback(
    (trackId: string, src: string, inPoint: number, outPoint: number, startTime: number) => {
      setState((prev) => {
        const track = prev.tracks.find((t) => t.id === trackId);
        if (!track || track.locked) return prev;
        const clipDuration = outPoint - inPoint;
        const clip: TimelineClip = {
          id: `clip_${Date.now()}`,
          src,
          trackId,
          startTime,
          endTime: startTime + clipDuration,
          inPoint,
          outPoint,
        };
        return { ...prev, clips: [...prev.clips, clip] };
      });
    },
    []
  );

  const moveClip = useCallback(
    (clipId: string, newTrackId: string, newStartTime: number) => {
      setState((prev) => {
        const clip = prev.clips.find((c) => c.id === clipId);
        const targetTrack = prev.tracks.find((t) => t.id === newTrackId);
        if (!clip || !targetTrack || targetTrack.locked) return prev;
        const duration = clip.endTime - clip.startTime;
        return {
          ...prev,
          clips: prev.clips.map((c) =>
            c.id === clipId
              ? { ...c, trackId: newTrackId, startTime: newStartTime, endTime: newStartTime + duration }
              : c
          ),
        };
      });
    },
    []
  );

  const splitClip = useCallback((clipId: string, atTime: number) => {
    setState((prev) => {
      const clip = prev.clips.find((c) => c.id === clipId);
      if (!clip) return prev;
      if (atTime <= clip.startTime || atTime >= clip.endTime) return prev;
      const splitOffset = atTime - clip.startTime;
      const firstHalf: TimelineClip = {
        ...clip,
        endTime: atTime,
        outPoint: clip.inPoint + splitOffset,
      };
      const secondHalf: TimelineClip = {
        ...clip,
        id: `clip_${Date.now()}`,
        startTime: atTime,
        inPoint: clip.inPoint + splitOffset,
      };
      return {
        ...prev,
        clips: prev.clips.map((c) => (c.id === clipId ? firstHalf : c)).concat(secondHalf),
      };
    });
  }, []);

  const deleteClip = useCallback((clipId: string) => {
    setState((prev) => ({ ...prev, clips: prev.clips.filter((c) => c.id !== clipId) }));
  }, []);



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
    // Multi-track timeline
    addTrack,
    setTrackMuted,
    setTrackLocked,
    removeTrack,
    addClip,
    moveClip,
    splitClip,
    deleteClip,
    // Reset
    resetVideo,
  };
}
