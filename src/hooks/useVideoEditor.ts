import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type {
  AudioCategory,
  AudioTrackSettings,
  AutoReframeAspect,
  LumetriColor,
  LumetriCurves,
  MagicMoviePlan,
  TimelineClip,
  TimelineMarker,
  TimelineTrack,
  TrackType,
  VideoEditorState,
  VideoTransition,
} from '../types';
import {
  createDefaultVideoEdits,
  normalizeTimelineZoom,
  type MediaBinding,
  type VideoEditSnapshot,
} from '../utils/editSnapshots';
import {
  commit,
  createHistory,
  redo as redoHistory,
  replacePresent,
  undo as undoHistory,
  type HistoryState,
} from '../utils/history';
import { fileMediaPath, revokeIfBlob } from '../utils/mediaFiles';
import { clamp } from '../utils/videoUtils';
import {
  createTimelineId,
  liftDelete,
  linkPair,
  markClipRange,
  moveClipTo,
  razorAtTime,
  rippleDelete,
  rippleTrimTo,
  rippleTrimToPlayhead,
  rollTo,
  slideTo,
  slipTo,
  splitClip as splitClipEdit,
  toggleLink,
  trimEdgeTo,
  unlinkClip,
} from '../utils/video/timelineEdit';
import { removeKeyframe, updateKeyframe, upsertKeyframe } from '../utils/video/keyframes';
import type { ClipKeyframe } from '../types';

interface VideoModel {
  file: File | null;
  videoUrl: string | null;
  mediaPath: string | null;
  mediaName: string | null;
  mediaMissing: boolean;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  timelineZoom: number;
  shuttle: number;
  history: HistoryState<VideoEditSnapshot>;
  revision: number;
}

function createVideoModel(): VideoModel {
  return {
    file: null,
    videoUrl: null,
    mediaPath: null,
    mediaName: null,
    mediaMissing: false,
    duration: 0,
    currentTime: 0,
    isPlaying: false,
    timelineZoom: 1,
    shuttle: 0,
    history: createHistory(createDefaultVideoEdits()),
    revision: 0,
  };
}

function nextShuttle(current: number, direction: 1 | -1, slow: boolean): number {
  const start = slow ? 0.25 : 1;
  if (direction > 0) {
    if (current < start) return start;
    return Math.min(8, current * 2);
  }
  if (current > -start) return -start;
  return Math.max(-8, current * 2);
}

function commitVideo(
  model: VideoModel,
  mutate: (snap: VideoEditSnapshot) => VideoEditSnapshot,
  coalesceKey?: string,
): VideoModel {
  const next = mutate(structuredClone(model.history.present));
  const history = commit(model.history, next, coalesceKey ? { coalesceKey } : undefined);
  if (history === model.history) return model;
  return { ...model, history, revision: model.revision + 1 };
}

function toVideoState(model: VideoModel): VideoEditorState {
  const snap = model.history.present;
  return {
    file: model.file,
    videoUrl: model.videoUrl,
    mediaPath: model.mediaPath,
    mediaName: model.mediaName,
    mediaMissing: model.mediaMissing,
    duration: model.duration,
    currentTime: model.currentTime,
    isPlaying: model.isPlaying,
    trimStart: snap.trimStart,
    trimEnd: snap.trimEnd,
    playbackRate: snap.playbackRate,
    volume: snap.volume,
    isMuted: snap.isMuted,
    lumetri: snap.lumetri,
    audio: snap.audio,
    markers: snap.markers,
    autoReframe: snap.autoReframe,
    timelineZoom: model.timelineZoom,
    tracks: snap.tracks,
    clips: snap.clips,
    snapping: snap.snapping,
    programKeyframes: snap.programKeyframes,
    shuttleRate: model.shuttle,
    transition: snap.transition,
    sourcePath: model.mediaPath,
  };
}

/**
 * Video editor state and operations.
 * The caller owns the videoRef and passes it in; this keeps the ref in the
 * component tree (correct React pattern) and avoids eslint react-hooks/refs
 * violations when passing hook-returned callbacks as JSX props.
 */
export function useVideoEditor(videoRef: RefObject<HTMLVideoElement | null>) {
  const [model, setModel] = useState<VideoModel>(createVideoModel);
  const modelRef = useRef(model);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  const present = model.history.present;

  // Keep the media element aligned with editorial transport settings after undo/redo.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (modelRef.current.shuttle === 0 && video.playbackRate !== present.playbackRate) {
      video.playbackRate = present.playbackRate;
    }
    if (video.volume !== present.volume) video.volume = present.volume;
    if (video.muted !== present.isMuted) video.muted = present.isMuted;
  }, [present.playbackRate, present.volume, present.isMuted, model.videoUrl, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.currentTime < present.trimStart) video.currentTime = present.trimStart;
    else if (present.trimEnd > 0 && video.currentTime > present.trimEnd) video.currentTime = present.trimEnd;
  }, [present.trimStart, present.trimEnd, model.videoUrl, videoRef]);

  // J/K/L shuttle is transport, not an undo step. Reverse playback steps the
  // element because HTML media cannot play a negative rate.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || model.shuttle === 0) return;
    if (model.shuttle > 0) {
      video.playbackRate = model.shuttle;
      void video.play();
      return () => {
        video.playbackRate = modelRef.current.history.present.playbackRate;
      };
    }
    video.pause();
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const current = videoRef.current;
      if (!current) return;
      const rate = modelRef.current.shuttle;
      if (rate >= 0) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const next = Math.max(0, current.currentTime + rate * dt);
      current.currentTime = next;
      setModel((prev) => ({
        ...prev,
        currentTime: next,
        isPlaying: false,
        shuttle: next <= 0 ? 0 : prev.shuttle,
      }));
      if (next > 0) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [model.shuttle, videoRef]);

  const loadVideo = useCallback((file: File, mediaPath?: string | null) => {
    const url = URL.createObjectURL(file);
    const explicit = mediaPath === undefined || mediaPath === null || mediaPath === '' ? fileMediaPath(file) : mediaPath;
    setModel((prev) => {
      revokeIfBlob(prev.videoUrl);
      return {
        ...createVideoModel(),
        file,
        videoUrl: url,
        mediaPath: explicit,
        mediaName: file.name,
        revision: prev.revision + 1,
      };
    });
  }, []);

  const onLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const duration = video.duration;
    setModel((prev) => {
      const snap = prev.history.present;
      const trimEnd = snap.trimEnd > 0 && snap.trimEnd <= duration + 0.001 ? snap.trimEnd : duration;
      const trimStart = Math.min(snap.trimStart, Math.max(0, trimEnd - 0.1));
      const nextSnap = { ...snap, trimStart, trimEnd };
      const pristine = prev.history.past.length === 0 && prev.history.future.length === 0;
      const history = pristine ? replacePresent(prev.history, nextSnap) : commit(prev.history, nextSnap);
      return {
        ...prev,
        duration,
        history,
        revision: history !== prev.history && !pristine ? prev.revision + 1 : prev.revision,
      };
    });
  }, [videoRef]);

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setModel((prev) => {
      const { trimStart, trimEnd } = prev.history.present;
      if (video.currentTime >= trimEnd) {
        video.pause();
        video.currentTime = trimStart;
        return { ...prev, currentTime: trimStart, isPlaying: false };
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
      setModel((prev) => ({ ...prev, isPlaying: true, shuttle: 0 }));
    },
    [videoRef],
  );

  const pause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setModel((prev) => ({ ...prev, isPlaying: false, shuttle: 0 }));
  }, [videoRef]);

  const togglePlay = useCallback(
    (isPlaying: boolean, trimStart: number, trimEnd: number) => {
      if (isPlaying) pause();
      else play(trimStart, trimEnd);
    },
    [pause, play],
  );

  const seek = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (!video) return;
      const clamped = clamp(time, 0, video.duration || 0);
      video.currentTime = clamped;
      setModel((prev) => ({ ...prev, currentTime: clamped, shuttle: 0 }));
    },
    [videoRef],
  );

  const stepFrame = useCallback(
    (direction: 1 | -1) => {
      const video = videoRef.current;
      if (!video) return;
      const frameDuration = 1 / 30;
      const next = clamp(video.currentTime + direction * frameDuration, 0, video.duration || 0);
      video.currentTime = next;
      setModel((prev) => ({ ...prev, currentTime: next, shuttle: 0 }));
    },
    [videoRef],
  );

  const skip = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      const next = clamp(video.currentTime + seconds, 0, video.duration || 0);
      video.currentTime = next;
      setModel((prev) => ({ ...prev, currentTime: next, shuttle: 0 }));
    },
    [videoRef],
  );

  const setTrimStart = useCallback(
    (value: number, trimEnd: number) => {
      const clamped = clamp(value, 0, trimEnd - 0.1);
      const video = videoRef.current;
      if (video && video.currentTime < clamped) video.currentTime = clamped;
      setModel((prev) => commitVideo(prev, (snap) => ({ ...snap, trimStart: clamped }), 'trimStart'));
    },
    [videoRef],
  );

  const setTrimEnd = useCallback((value: number, trimStart: number, duration: number) => {
    const clamped = clamp(value, trimStart + 0.1, duration);
    setModel((prev) => commitVideo(prev, (snap) => ({ ...snap, trimEnd: clamped }), 'trimEnd'));
  }, []);

  const setInPoint = useCallback(
    (currentTime: number, trimEnd: number) => {
      setTrimStart(currentTime, trimEnd);
    },
    [setTrimStart],
  );

  const setOutPoint = useCallback(
    (currentTime: number, trimStart: number, duration: number) => {
      setTrimEnd(currentTime, trimStart, duration);
    },
    [setTrimEnd],
  );

  const setPlaybackRate = useCallback(
    (rate: number) => {
      const video = videoRef.current;
      if (video) video.playbackRate = rate;
      setModel((prev) => commitVideo(prev, (snap) => ({ ...snap, playbackRate: rate }), 'playbackRate'));
    },
    [videoRef],
  );

  const setVolume = useCallback(
    (vol: number) => {
      const video = videoRef.current;
      const clamped = clamp(vol, 0, 1);
      if (video) video.volume = clamped;
      setModel((prev) =>
        commitVideo(prev, (snap) => ({ ...snap, volume: clamped, isMuted: clamped === 0 }), 'volume'),
      );
    },
    [videoRef],
  );

  const toggleMute = useCallback(
    (isMuted: boolean) => {
      const video = videoRef.current;
      if (!video) return;
      const newMuted = !isMuted;
      video.muted = newMuted;
      setModel((prev) => commitVideo(prev, (snap) => ({ ...snap, isMuted: newMuted })));
    },
    [videoRef],
  );

  const updateLumetriBasic = useCallback(
    (key: keyof Omit<LumetriColor, 'curves' | 'wheels'>, value: number) => {
      setModel((prev) =>
        commitVideo(prev, (snap) => ({ ...snap, lumetri: { ...snap.lumetri, [key]: value } }), `lumetri:${key}`),
      );
    },
    [],
  );

  const updateLumetriCurves = useCallback((key: keyof LumetriCurves, value: number) => {
    setModel((prev) =>
      commitVideo(
        prev,
        (snap) => ({ ...snap, lumetri: { ...snap.lumetri, curves: { ...snap.lumetri.curves, [key]: value } } }),
        `curve:${key}`,
      ),
    );
  }, []);

  const updateColorWheel = useCallback(
    (wheel: 'shadows' | 'midtones' | 'highlights', axis: 'x' | 'y' | 'luminance', value: number) => {
      setModel((prev) =>
        commitVideo(
          prev,
          (snap) => ({
            ...snap,
            lumetri: {
              ...snap.lumetri,
              wheels: {
                ...snap.lumetri.wheels,
                [wheel]: { ...snap.lumetri.wheels[wheel], [axis]: value },
              },
            },
          }),
          `wheel:${wheel}.${axis}`,
        ),
      );
    },
    [],
  );

  const setLumetri = useCallback((lumetri: LumetriColor) => {
    setModel((prev) => commitVideo(prev, (snap) => ({ ...snap, lumetri })));
  }, []);

  const resetLumetri = useCallback(() => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({ ...snap, lumetri: structuredClone(createDefaultVideoEdits().lumetri) })),
    );
  }, []);

  const setAudio = useCallback((audio: AudioTrackSettings) => {
    setModel((prev) => commitVideo(prev, (snap) => ({ ...snap, audio })));
  }, []);

  const updateAudio = useCallback((key: keyof AudioTrackSettings, value: number | boolean | AudioCategory) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({ ...snap, audio: { ...snap.audio, [key]: value } }), `audio:${String(key)}`),
    );
  }, []);

  const addMarker = useCallback((time: number, label = '', color: TimelineMarker['color'] = 'yellow') => {
    const marker: TimelineMarker = { id: `m_${Date.now()}`, time, label, color };
    setModel((prev) =>
      commitVideo(prev, (snap) => ({
        ...snap,
        markers: [...snap.markers, marker].sort((a, b) => a.time - b.time),
      })),
    );
  }, []);

  const removeMarker = useCallback((id: string) => {
    setModel((prev) => commitVideo(prev, (snap) => ({ ...snap, markers: snap.markers.filter((m) => m.id !== id) })));
  }, []);

  const setAutoReframe = useCallback((aspect: AutoReframeAspect) => {
    setModel((prev) => commitVideo(prev, (snap) => ({ ...snap, autoReframe: aspect })));
  }, []);

  const setTransition = useCallback((transition: VideoTransition) => {
    setModel((prev) => commitVideo(prev, (snap) => ({ ...snap, transition })));
  }, []);

  const setTimelineZoom = useCallback((zoom: number) => {
    const next = normalizeTimelineZoom(clamp(zoom, 0.5, 8));
    setModel((prev) => (prev.timelineZoom === next ? prev : { ...prev, timelineZoom: next }));
  }, []);

  const addTrack = useCallback((type: TrackType) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => {
        const typeCount = snap.tracks.filter((t) => t.type === type).length + 1;
        const prefix = type === 'video' ? 'V' : 'A';
        const id = `${prefix.toLowerCase()}${typeCount}_${Date.now()}`;
        const track: TimelineTrack = { id, type, name: `${prefix}${typeCount}`, muted: false, locked: false };
        return { ...snap, tracks: [...snap.tracks, track] };
      }),
    );
  }, []);

  const setTrackMuted = useCallback((trackId: string, muted: boolean) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({
        ...snap,
        tracks: snap.tracks.map((t) => (t.id === trackId ? { ...t, muted } : t)),
      })),
    );
  }, []);

  const setTrackLocked = useCallback((trackId: string, locked: boolean) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({
        ...snap,
        tracks: snap.tracks.map((t) => (t.id === trackId ? { ...t, locked } : t)),
      })),
    );
  }, []);

  const removeTrack = useCallback((trackId: string) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({
        ...snap,
        tracks: snap.tracks.filter((t) => t.id !== trackId),
        clips: snap.clips.filter((c) => c.trackId !== trackId),
      })),
    );
  }, []);

  const addClip = useCallback((trackId: string, src: string, inPoint: number, outPoint: number, startTime: number) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => {
        const track = snap.tracks.find((t) => t.id === trackId);
        if (!track || track.locked) return snap;
        const clipDuration = outPoint - inPoint;
        const clip: TimelineClip = {
          id: createTimelineId('clip'),
          src,
          trackId,
          startTime,
          endTime: startTime + clipDuration,
          inPoint,
          outPoint,
          linkId: null,
          keyframes: [],
        };
        return { ...snap, clips: [...snap.clips, clip] };
      }),
    );
  }, []);

  const moveClip = useCallback((clipId: string, newTrackId: string, newStartTime: number, coalesceKey?: string) => {
    setModel((prev) =>
      commitVideo(
        prev,
        (snap) => ({ ...snap, clips: moveClipTo(snap.clips, snap.tracks, clipId, newTrackId, newStartTime) }),
        coalesceKey,
      ),
    );
  }, []);

  const splitClip = useCallback((clipId: string, atTime: number) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({ ...snap, clips: splitClipEdit(snap.clips, snap.tracks, clipId, atTime) })),
    );
  }, []);

  const razorAt = useCallback((atTime: number) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({ ...snap, clips: razorAtTime(snap.clips, snap.tracks, atTime) })),
    );
  }, []);

  const deleteClip = useCallback((clipId: string) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({ ...snap, clips: liftDelete(snap.clips, snap.tracks, [clipId]) })),
    );
  }, []);

  const rippleDeleteClip = useCallback((clipId: string) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({ ...snap, clips: rippleDelete(snap.clips, snap.tracks, [clipId]) })),
    );
  }, []);

  const trimClip = useCallback((clipId: string, edge: 'in' | 'out', time: number, coalesceKey?: string) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({ ...snap, clips: trimEdgeTo(snap.clips, snap.tracks, clipId, edge, time) }), coalesceKey),
    );
  }, []);

  const rippleTrimClip = useCallback((clipId: string, edge: 'in' | 'out', value: number, coalesceKey?: string) => {
    setModel((prev) =>
      commitVideo(
        prev,
        (snap) => ({ ...snap, clips: rippleTrimTo(snap.clips, snap.tracks, clipId, edge, value) }),
        coalesceKey,
      ),
    );
  }, []);

  const rollClip = useCallback((clipId: string, edge: 'in' | 'out', cutTime: number, coalesceKey?: string) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({ ...snap, clips: rollTo(snap.clips, snap.tracks, clipId, edge, cutTime) }), coalesceKey),
    );
  }, []);

  const slipClip = useCallback((clipId: string, newInPoint: number, coalesceKey?: string) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({ ...snap, clips: slipTo(snap.clips, snap.tracks, clipId, newInPoint) }), coalesceKey),
    );
  }, []);

  const slideClip = useCallback((clipId: string, newStart: number, coalesceKey?: string) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({ ...snap, clips: slideTo(snap.clips, snap.tracks, clipId, newStart) }), coalesceKey),
    );
  }, []);

  const linkClips = useCallback((idA: string, idB: string) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({ ...snap, clips: linkPair(snap.clips, idA, idB, createTimelineId('link')) })),
    );
  }, []);

  const unlinkClips = useCallback((clipId: string) => {
    setModel((prev) => commitVideo(prev, (snap) => ({ ...snap, clips: unlinkClip(snap.clips, clipId) })));
  }, []);

  const toggleClipLink = useCallback((selectedId: string | null, playhead: number) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({
        ...snap,
        clips: toggleLink(snap.clips, selectedId, playhead, snap.tracks, createTimelineId('link')),
      })),
    );
  }, []);

  const rippleToPlayhead = useCallback((edge: 'previous' | 'next', time: number) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({ ...snap, clips: rippleTrimToPlayhead(snap.clips, snap.tracks, time, edge) })),
    );
  }, []);

  const setSnapping = useCallback((snapping: boolean) => {
    setModel((prev) => commitVideo(prev, (snap) => ({ ...snap, snapping })));
  }, []);

  const clearInOut = useCallback((duration: number) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({
        ...snap,
        trimStart: 0,
        trimEnd: duration > 0 ? duration : snap.trimEnd,
      })),
    );
  }, []);

  const markInOut = useCallback((start: number, end: number) => {
    const trimStart = clamp(Math.min(start, end), 0, Math.max(0, end - 0.1));
    const trimEnd = Math.max(trimStart + 0.1, end);
    setModel((prev) => commitVideo(prev, (snap) => ({ ...snap, trimStart, trimEnd })));
  }, []);

  const markClipAt = useCallback((time: number) => {
    setModel((prev) => {
      const range = markClipRange(prev.history.present.clips, prev.history.present.tracks, time);
      if (!range) return prev;
      return commitVideo(prev, (snap) => ({ ...snap, trimStart: range.start, trimEnd: Math.max(range.start + 0.1, range.end) }));
    });
  }, []);

  const shuttleForward = useCallback((slow = false) => {
    setModel((prev) => ({ ...prev, shuttle: nextShuttle(prev.shuttle, 1, slow), isPlaying: true }));
  }, []);

  const shuttleReverse = useCallback((slow = false) => {
    setModel((prev) => ({ ...prev, shuttle: nextShuttle(prev.shuttle, -1, slow), isPlaying: false }));
  }, []);

  const shuttleStop = useCallback(() => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.playbackRate = modelRef.current.history.present.playbackRate;
    }
    setModel((prev) => (prev.shuttle === 0 && !prev.isPlaying ? prev : { ...prev, shuttle: 0, isPlaying: false }));
  }, [videoRef]);

  const addClipKeyframe = useCallback((clipId: string, keyframe: ClipKeyframe) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({
        ...snap,
        clips: snap.clips.map((clip) =>
          clip.id === clipId ? { ...clip, keyframes: upsertKeyframe(clip.keyframes ?? [], keyframe) } : clip,
        ),
      })),
    );
  }, []);

  const updateClipKeyframe = useCallback(
    (clipId: string, keyframeId: string, patch: Partial<Pick<ClipKeyframe, 'time' | 'value' | 'easing'>>, coalesceKey?: string) => {
      setModel((prev) =>
        commitVideo(
          prev,
          (snap) => ({
            ...snap,
            clips: snap.clips.map((clip) =>
              clip.id === clipId ? { ...clip, keyframes: updateKeyframe(clip.keyframes ?? [], keyframeId, patch) } : clip,
            ),
          }),
          coalesceKey,
        ),
      );
    },
    [],
  );

  const removeClipKeyframe = useCallback((clipId: string, keyframeId: string) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({
        ...snap,
        clips: snap.clips.map((clip) =>
          clip.id === clipId ? { ...clip, keyframes: removeKeyframe(clip.keyframes ?? [], keyframeId) } : clip,
        ),
      })),
    );
  }, []);

  const addProgramKeyframe = useCallback((keyframe: ClipKeyframe) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({ ...snap, programKeyframes: upsertKeyframe(snap.programKeyframes, keyframe) })),
    );
  }, []);

  const updateProgramKeyframe = useCallback(
    (keyframeId: string, patch: Partial<Pick<ClipKeyframe, 'time' | 'value' | 'easing'>>, coalesceKey?: string) => {
      setModel((prev) =>
        commitVideo(
          prev,
          (snap) => ({ ...snap, programKeyframes: updateKeyframe(snap.programKeyframes, keyframeId, patch) }),
          coalesceKey,
        ),
      );
    },
    [],
  );

  const removeProgramKeyframe = useCallback((keyframeId: string) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => ({ ...snap, programKeyframes: removeKeyframe(snap.programKeyframes, keyframeId) })),
    );
  }, []);

  const applyMagicPlan = useCallback(
    (plan: MagicMoviePlan, duration: number) => {
      const video = videoRef.current;
      if (video && plan.playbackRate !== 1) video.playbackRate = plan.playbackRate;
      const stamped = Date.now();
      setModel((prev) =>
        commitVideo(prev, (snap) => {
          const markers = plan.scenes.map((scene, index) => ({
            id: `m_${stamped}_${index}`,
            time: scene.startPct * duration,
            label: scene.label,
            color: scene.color,
          }));
          return {
            ...snap,
            lumetri: plan.lumetri,
            audio: plan.audio,
            autoReframe: plan.autoReframe,
            playbackRate: plan.playbackRate,
            markers: [...snap.markers, ...markers].sort((a, b) => a.time - b.time),
          };
        }),
      );
    },
    [videoRef],
  );

  const resetVideo = useCallback((videoUrl: string | null) => {
    setModel((prev) => {
      revokeIfBlob(videoUrl);
      if (prev.videoUrl && prev.videoUrl !== videoUrl) revokeIfBlob(prev.videoUrl);
      return { ...createVideoModel(), revision: prev.revision + 1 };
    });
  }, []);

  const undo = useCallback(() => {
    setModel((prev) => {
      const history = undoHistory(prev.history);
      if (history === prev.history) return prev;
      return { ...prev, history, revision: prev.revision + 1 };
    });
  }, []);

  const redo = useCallback(() => {
    setModel((prev) => {
      const history = redoHistory(prev.history);
      if (history === prev.history) return prev;
      return { ...prev, history, revision: prev.revision + 1 };
    });
  }, []);

  const getEdits = useCallback((): VideoEditSnapshot => structuredClone(modelRef.current.history.present), []);

  const setMedia = useCallback((media: MediaBinding) => {
    setModel((prev) => {
      if (prev.videoUrl !== media.url) revokeIfBlob(prev.videoUrl);
      return {
        ...prev,
        file: media.file,
        videoUrl: media.url,
        mediaPath: media.path,
        mediaName: media.name,
        mediaMissing: media.missing,
        currentTime: 0,
        isPlaying: false,
        revision: prev.revision + 1,
      };
    });
  }, []);

  const restore = useCallback((edits: VideoEditSnapshot, media: MediaBinding | null, timelineZoom?: number) => {
    setModel((prev) => {
      if (prev.videoUrl !== media?.url) revokeIfBlob(prev.videoUrl);
      return {
        file: media?.file ?? null,
        videoUrl: media?.url ?? null,
        mediaPath: media?.path ?? null,
        mediaName: media?.name ?? null,
        mediaMissing: media?.missing ?? false,
        duration: 0,
        currentTime: 0,
        isPlaying: false,
        timelineZoom: timelineZoom ?? prev.timelineZoom,
        shuttle: 0,
        history: createHistory(edits),
        revision: prev.revision + 1,
      };
    });
  }, []);

  const state = toVideoState(model);

  return {
    state,
    revision: model.revision,
    canUndo: model.history.past.length > 0,
    canRedo: model.history.future.length > 0,
    loadVideo,
    onLoadedMetadata,
    onTimeUpdate,
    play,
    pause,
    togglePlay,
    seek,
    stepFrame,
    skip,
    setTrimStart,
    setTrimEnd,
    setInPoint,
    setOutPoint,
    setPlaybackRate,
    setVolume,
    toggleMute,
    setLumetri,
    updateLumetriBasic,
    updateLumetriCurves,
    updateColorWheel,
    resetLumetri,
    setAudio,
    updateAudio,
    addMarker,
    removeMarker,
    setAutoReframe,
    setTransition,
    setTimelineZoom,
    addTrack,
    setTrackMuted,
    setTrackLocked,
    removeTrack,
    addClip,
    moveClip,
    splitClip,
    razorAt,
    deleteClip,
    rippleDeleteClip,
    trimClip,
    rippleTrimClip,
    rollClip,
    slipClip,
    slideClip,
    linkClips,
    unlinkClips,
    toggleClipLink,
    rippleToPlayhead,
    setSnapping,
    clearInOut,
    markInOut,
    markClipAt,
    shuttleForward,
    shuttleReverse,
    shuttleStop,
    addClipKeyframe,
    updateClipKeyframe,
    removeClipKeyframe,
    addProgramKeyframe,
    updateProgramKeyframe,
    removeProgramKeyframe,
    applyMagicPlan,
    resetVideo,
    undo,
    redo,
    getEdits,
    setMedia,
    restore,
  };
}

export type VideoEditorApi = ReturnType<typeof useVideoEditor>;
