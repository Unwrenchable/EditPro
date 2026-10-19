/**
 * Renderer entry for titles and shape graphics. The sampler and the ffmpeg
 * filters live together so the monitor and the export cannot drift apart.
 */
export {
  MOTION_TEMPLATE_FORMAT,
  MOTION_TEMPLATE_VERSION,
  builtinMotionTemplates,
  createMotionDocument,
  motionGraphicFilters,
  normalizeMotionDocument,
  parseMotionTemplate,
  placeMotion,
  sampleMotion,
  serializeMotionTemplate,
} from '../../../electron/export/motionGraphics';

export type {
  MotionAlign,
  MotionChannel,
  MotionDocument,
  MotionEase,
  MotionKey,
  MotionPlacement,
  MotionShape,
  MotionShapeKind,
  MotionTemplate,
  MotionText,
} from '../../../electron/export/motionGraphics';
