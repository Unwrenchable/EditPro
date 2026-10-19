import { describe, expect, it } from 'vitest';
import type { TimelineClip, TrackType } from '../types';
import edlSample from './fixtures/interview.edl?raw';
import fcpxmlSample from './fixtures/interview.fcpxml?raw';
import premiereSample from './fixtures/interview.premiere.xml?raw';
import { createDefaultTracks } from '../utils/editSnapshots';
import {
  detectInterchange,
  exportInterchange,
  importInterchange,
  type InterchangeFormat,
} from '../utils/interchange';
import { importEdl } from '../utils/interchange/edl';
import { sequenceFromTimeline, timelineFromSequence, type InterchangeClip, type InterchangeSequence } from '../utils/interchange/model';
import { fileUrlToPath, pathToFileUrl } from '../utils/interchange/paths';
import {
  formatTimecode,
  framesToSeconds,
  timecodeToFrames,
  timecodeToSeconds,
} from '../utils/interchange/timecode';
import { escapeXml, parseXml } from '../utils/interchange/xml';

const interviewFields = {
  video: {
    name: 'interview.mov',
    path: '/films/interview.mov',
    trackName: 'V1',
    trackType: 'video' as const,
    start: 0,
    end: 4,
    inPoint: 3600,
    outPoint: 3604,
  },
  audio: {
    name: 'room.wav',
    path: '/films/room.wav',
    trackName: 'A1',
    trackType: 'audio' as const,
    start: 0,
    end: 4,
    inPoint: 3600,
    outPoint: 3604,
  },
};

function expectClip(
  actual: InterchangeClip,
  expected: {
    name: string;
    path: string;
    trackName: string;
    trackType: TrackType;
    start: number;
    end: number;
    inPoint: number;
    outPoint: number;
  },
  frameRate: number,
): void {
  const tolerance = framesToSeconds(1, frameRate) + 1e-6;
  expect(actual.name).toBe(expected.name);
  expect(actual.path).toBe(expected.path);
  expect(actual.trackName).toBe(expected.trackName);
  expect(actual.trackType).toBe(expected.trackType);
  expect(Math.abs(actual.start - expected.start)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.end - expected.end)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.inPoint - expected.inPoint)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.outPoint - expected.outPoint)).toBeLessThanOrEqual(tolerance);
}

function expectInterview(sequence: InterchangeSequence, frameRate = 24): void {
  expect(sequence.name).toBe('INTERVIEW');
  expect(sequence.frameRate).toBeCloseTo(frameRate, 3);
  expect(sequence.dropFrame).toBe(false);
  expect(sequence.clips).toHaveLength(2);
  const video = sequence.clips.find((clip) => clip.trackType === 'video');
  const audio = sequence.clips.find((clip) => clip.trackType === 'audio');
  expect(video).toBeTruthy();
  expect(audio).toBeTruthy();
  expectClip(video!, interviewFields.video, frameRate);
  expectClip(audio!, interviewFields.audio, frameRate);
}

function roundTrip(sequence: InterchangeSequence, format: InterchangeFormat): InterchangeSequence {
  const extension = format === 'edl' ? 'cut.edl' : format === 'fcpxml' ? 'cut.fcpxml' : 'cut.xml';
  const exported = exportInterchange(sequence, format);
  const once = importInterchange(exported, extension, sequence.frameRate);
  const twice = importInterchange(exportInterchange(once, format), extension, once.frameRate);
  return twice;
}

describe('SMPTE timecode', () => {
  it('maps the first frame of minute one in drop-frame to frame 1800', () => {
    expect(timecodeToFrames('00:01:00;02', 30, true)).toBe(1800);
    expect(timecodeToFrames('00:01:00;02', 29.97, true)).toBe(1800);
    expect(formatTimecode(1800, 29.97, true)).toBe('00:01:00;02');
    expect(formatTimecode(17982, 29.97, true)).toBe('00:10:00;00');
    expect(timecodeToFrames('00:10:00;00', 29.97, true)).toBe(17982);
  });

  it('treats 01:00:00:00 at 24 fps as one hour, 3600 seconds', () => {
    expect(timecodeToFrames('01:00:00:00', 24, false)).toBe(86400);
    expect(timecodeToSeconds('01:00:00:00', 24, false)).toBe(3600);
    expect(formatTimecode(86400, 24, false)).toBe('01:00:00:00');
  });
});

describe('media paths', () => {
  it('round-trips posix and windows file URLs', () => {
    expect(pathToFileUrl('/films/a.mov')).toBe('file:///films/a.mov');
    expect(pathToFileUrl('C:/films/a.mov')).toBe('file://localhost/C:/films/a.mov');
    expect(fileUrlToPath('file:///films/a.mov')).toBe('/films/a.mov');
    expect(fileUrlToPath('file://localhost/C:/films/a.mov')).toBe('C:/films/a.mov');
    expect(fileUrlToPath('file:///films/a%20b.mov')).toBe('/films/a b.mov');
    expect(pathToFileUrl('/films/a b.mov')).toBe('file:///films/a%20b.mov');
  });
});

describe('XML text', () => {
  it('escapes and restores reserved characters', () => {
    expect(escapeXml('A & B < "')).toBe('A &amp; B &lt; &quot;');
    expect(parseXml('<name>A &amp; B</name>').text).toBe('A & B');
  });
});

describe('sample interchange files', () => {
  it('imports the CMX 3600 interview and round-trips it', () => {
    const imported = importInterchange(edlSample, 'interview.edl', 24);
    expectInterview(imported);
    expect(imported.clips.find((clip) => clip.trackType === 'video')?.inPoint).toBe(3600);
    expect(detectInterchange(edlSample, 'interview.edl')).toBe('edl');
    const again = roundTrip(imported, 'edl');
    expectInterview(again);
    expect(exportInterchange(imported, 'edl')).toContain('FCM: NON-DROP FRAME');
    expect(exportInterchange(imported, 'edl')).toContain('01:00:00:00 01:00:04:00 00:00:00:00 00:00:04:00');
  });

  it('imports FCPXML 1.9, including a connected audio clip, and round-trips it', () => {
    const imported = importFcpx(fcpxmlSample);
    expectInterview(imported);
    expect(imported.width).toBe(1920);
    expect(imported.height).toBe(1080);
    const again = roundTrip(imported, 'fcpxml');
    expectInterview(again);
    expect(exportInterchange(imported, 'fcpxml')).toContain('<fcpxml version="1.9">');
  });

  it('imports Premiere and FCP7 xmeml and round-trips it', () => {
    const imported = importInterchange(premiereSample, 'interview.premiere.xml');
    expectInterview(imported);
    expect(imported.width).toBe(1920);
    expect(imported.height).toBe(1080);
    const again = roundTrip(imported, 'xmeml');
    expectInterview(again);
    expect(exportInterchange(imported, 'xmeml')).toContain('<xmeml version="4">');
  });
});

function importFcpx(text: string): InterchangeSequence {
  return importInterchange(text, 'interview.fcpxml');
}

describe('interchange edge cases', () => {
  it('splits an AA event into two audio clips', () => {
    const text = [
      'TITLE: BOTH',
      'FCM: NON-DROP FRAME',
      '',
      '001  ROOM     AA    C        00:00:00:00 00:00:02:00 00:00:01:00 00:00:03:00',
      '* FROM CLIP NAME: room.wav',
      '* SOURCE FILE: /films/room.wav',
      '',
    ].join('\n');
    const sequence = importEdl(text, 24);
    expect(sequence.clips).toHaveLength(2);
    expect(sequence.clips.map((clip) => clip.trackName).sort()).toEqual(['A1', 'A2']);
    for (const clip of sequence.clips) {
      expect(clip.trackType).toBe('audio');
      expect(clip.start).toBe(1);
      expect(clip.end).toBe(3);
      expect(clip.inPoint).toBe(0);
      expect(clip.outPoint).toBe(2);
      expect(clip.path).toBe('/films/room.wav');
    }
  });

  it('reads NTSC rates, drop frame, file references, and escaped names', () => {
    const text = `<?xml version="1.0" encoding="UTF-8"?>
<xmeml version="4">
  <sequence>
    <name>REF</name>
    <rate><timebase>30</timebase><ntsc>TRUE</ntsc></rate>
    <timecode><displayformat>DF</displayformat></timecode>
    <media>
      <video>
        <format><samplecharacteristics><width>1280</width><height>720</height></samplecharacteristics></format>
        <track>
          <clipitem id="a">
            <name>A &amp; B</name>
            <start>0</start><end>30</end><in>0</in><out>30</out>
            <file id="file-1"/>
          </clipitem>
        </track>
        <track>
          <name>V2</name>
          <clipitem id="b">
            <name>later</name>
            <start>30</start><end>60</end><in>30</in><out>60</out>
            <file id="file-1">
              <name>A &amp; B.mov</name>
              <pathurl>file://localhost/C:/films/a.mov</pathurl>
            </file>
          </clipitem>
        </track>
      </video>
    </media>
  </sequence>
</xmeml>`;
    const sequence = importInterchange(text, 'ref.xml');
    expect(sequence.frameRate).toBeCloseTo(29.97, 3);
    expect(sequence.dropFrame).toBe(true);
    expect(sequence.width).toBe(1280);
    expect(sequence.height).toBe(720);
    expect(sequence.clips).toHaveLength(2);
    expect(sequence.clips[0]?.name).toBe('A & B');
    expect(sequence.clips[0]?.path).toBe('C:/films/a.mov');
    expect(sequence.clips[0]?.trackName).toBe('V1');
    expect(sequence.clips[1]?.trackName).toBe('V2');
    expect(sequence.clips[1]?.start).toBeCloseTo(framesToSeconds(30, 29.97), 6);
    const again = roundTrip(sequence, 'xmeml');
    expect(again.dropFrame).toBe(true);
    expect(again.frameRate).toBeCloseTo(29.97, 3);
    expect(again.clips[0]?.name).toBe('A & B');
    expect(again.clips[0]?.path).toBe('C:/films/a.mov');
    expect(again.clips[1]?.trackName).toBe('V2');
  });

  it('round-trips a drop-frame 29.97 sequence through every format within one frame', () => {
    const sequence: InterchangeSequence = {
      name: 'Drop',
      frameRate: 29.97,
      dropFrame: true,
      width: 1920,
      height: 1080,
      clips: [{
        id: 'c1',
        name: 'cam.mov',
        path: '/films/cam.mov',
        trackName: 'V1',
        trackType: 'video',
        start: 60,
        end: 64,
        inPoint: 3600,
        outPoint: 3604,
      }],
    };
    for (const format of ['edl', 'fcpxml', 'xmeml'] as const) {
      const again = roundTrip(sequence, format);
      expect(again.dropFrame).toBe(true);
      expect(again.frameRate).toBeCloseTo(29.97, 3);
      expectClip(again.clips[0], sequence.clips[0], 29.97);
      expect(exportInterchange(sequence, 'edl')).toContain('FCM: DROP FRAME');
      expect(exportInterchange(sequence, 'edl')).toContain(';');
    }
  });

  it('keeps editorial times and leaves keyframes off the interchange document', () => {
    const source: TimelineClip = {
      id: 'c1',
      src: '/films/interview.mov',
      trackId: 'v1',
      startTime: 0,
      endTime: 4,
      inPoint: 3600,
      outPoint: 3604,
      linkId: 'link-1',
      keyframes: [{ id: 'kf', time: 1, property: 'opacity', value: 0.2, easing: 'linear' }],
    };
    const sequence = sequenceFromTimeline(createDefaultTracks(), [source], { name: 'Interview', frameRate: 24 });
    expect(sequence.clips).toHaveLength(1);
    expect(sequence.clips[0]).not.toHaveProperty('keyframes');
    const timeline = timelineFromSequence(sequence);
    expect(timeline.tracks.map((track) => track.id)).toEqual(['v1']);
    expect(timeline.clips[0]).toMatchObject({
      src: '/films/interview.mov',
      startTime: 0,
      endTime: 4,
      inPoint: 3600,
      outPoint: 3604,
      linkId: null,
      keyframes: [],
    });
  });
});
