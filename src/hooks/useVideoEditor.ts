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
import { monitorLinearGain, type CreativeState } from '../utils/video/creative';
import { clamp } from '../utils/videoUtils';

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
    history: createHistory(createDefaultVideoEdits()),
    revision: 0,
  };
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
    transition: snap.transition,
    creative: snap.creative,
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
    if (video.playbackRate !== present.playbackRate) video.playbackRate = present.playbackRate;
    const monitor = Math.min(1, monitorLinearGain({
      master: present.volume,
      muted: present.isMuted,
      tracks: present.tracks,
      creative: present.creative,
      sourceTime: model.currentTime,
      trimStart: present.trimStart,
      trimEnd: present.trimEnd,
      playbackRate: present.playbackRate,
    }));
    if (video.volume !== monitor) video.volume = monitor;
    if (video.muted !== present.isMuted) video.muted = present.isMuted;
  }, [present, model.currentTime, model.videoUrl, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.currentTime < present.trimStart) video.currentTime = present.trimStart;
    else if (present.trimEnd > 0 && video.currentTime > present.trimEnd) video.currentTime = present.trimEnd;
  }, [present.trimStart, present.trimEnd, model.videoUrl, videoRef]);

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
      setModel((prev) => ({ ...prev, isPlaying: true }));
    },
    [videoRef],
  );

  const pause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setModel((prev) => ({ ...prev, isPlaying: false }));
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
      setModel((prev) => ({ ...prev, currentTime: clamped }));
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
      setModel((prev) => ({ ...prev, currentTime: next }));
    },
    [videoRef],
  );

  const skip = useCallback(
    (seconds: number) => {
      const video = videoRef.current;
      if (!video) return;
      const next = clamp(video.currentTime + seconds, 0, video.duration || 0);
      video.currentTime = next;
      setModel((prev) => ({ ...prev, currentTime: next }));
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
      commitVideo(prev, (snap) => {
        const clips = snap.clips.filter((c) => c.trackId !== trackId);
        const clipIds = new Set(clips.map((clip) => clip.id));
        return {
          ...snap,
          tracks: snap.tracks.filter((t) => t.id !== trackId),
          clips,
          creative: {
            ...snap.creative,
            trackMix: snap.creative.trackMix.filter((mix) => mix.trackId !== trackId),
            titles: snap.creative.titles.filter((title) => title.trackId !== trackId),
            clipAudio: snap.creative.clipAudio.filter((audio) => clipIds.has(audio.clipId)),
            transitions: snap.creative.transitions.filter((item) =>
              clipIds.has(item.outgoingClipId) && clipIds.has(item.incomingClipId)),
          },
        };
      }),
    );
  }, []);

  const addClip = useCallback((trackId: string, src: string, inPoint: number, outPoint: number, startTime: number) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => {
        const track = snap.tracks.find((t) => t.id === trackId);
        if (!track || track.locked) return snap;
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
        return { ...snap, clips: [...snap.clips, clip] };
      }),
    );
  }, []);

  const moveClip = useCallback((clipId: string, newTrackId: string, newStartTime: number) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => {
        const clip = snap.clips.find((c) => c.id === clipId);
        const targetTrack = snap.tracks.find((t) => t.id === newTrackId);
        if (!clip || !targetTrack || targetTrack.locked) return snap;
        const duration = clip.endTime - clip.startTime;
        return {
          ...snap,
          clips: snap.clips.map((c) =>
            c.id === clipId
              ? { ...c, trackId: newTrackId, startTime: newStartTime, endTime: newStartTime + duration }
              : c,
          ),
        };
      }),
    );
  }, []);

  const splitClip = useCallback((clipId: string, atTime: number) => {
    setModel((prev) =>
      commitVideo(prev, (snap) => {
        const clip = snap.clips.find((c) => c.id === clipId);
        if (!clip) return snap;
        if (atTime <= clip.startTime || atTime >= clip.endTime) return snap;
        const splitOffset = atTime - clip.startTime;
        const firstHalf: TimelineClip = { ...clip, endTime: atTime, outPoint: clip.inPoint + splitOffset };
        const secondId = `clip_${Date.now()}`;
        const secondHalf: TimelineClip = {
          ...clip,
          id: secondId,
          startTime: atTime,
          inPoint: clip.inPoint + splitOffset,
        };
        const existingAudio = snap.creative.clipAudio.find((audio) => audio.clipId === clipId);
        const clipAudio = existingAudio
          ? [
              ...snap.creative.clipAudio,
              { ...existingAudio, clipId: secondId, keyframes: [], fadeIn: 0 },
            ]
          : snap.creative.clipAudio;
        return {
          ...snap,
          clips: snap.clips.map((c) => (c.id === clipId ? firstHalf : c)).concat(secondHalf),
          creative: {
            ...snap.creative,
            clipAudio,
            transitions: snap.creative.transitions.filter((item) =>
              item.outgoingClipId !== clipId && item.incomingClipId !== clipId),
          },
        };
      }),
    );
  }, []);

  const deleteClip = useCallback((clipId: string) => {
    setModel((prev) => commitVideo(prev, (snap) => ({
      ...snap,
      clips: snap.clips.filter((c) => c.id !== clipId),
      creative: {
        ...snap.creative,
        clipAudio: snap.creative.clipAudio.filter((audio) => audio.clipId !== clipId),
        transitions: snap.creative.transitions.filter((item) =>
          item.outgoingClipId !== clipId && item.incomingClipId !== clipId),
      },
    })));
  }, []);

  const setCreative = useCallback((creative: CreativeState, coalesceKey?: string) => {
    setModel((prev) => commitVideo(prev, (snap) => ({ ...snap, creative }), coalesceKey));
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
    deleteClip,
    setCreative,
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
