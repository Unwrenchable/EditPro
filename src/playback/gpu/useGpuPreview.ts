import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  selectPreviewBackend,
  WEBGL_FRAGMENT_SHADER,
  WEBGL_VERTEX_SHADER,
  WEBGPU_SHADER,
  type PreviewBackend,
  type PreviewGrade,
} from './grade';

const MAX_PREVIEW_EDGE = 1280;

interface GpuTexture {
  destroy(): void;
  createView(): unknown;
}

interface GpuBuffer {
  destroy(): void;
}

interface GpuDevice {
  queue: {
    submit(commands: unknown[]): void;
    writeBuffer(buffer: GpuBuffer, offset: number, data: BufferSource): void;
    copyExternalImageToTexture(
      source: { source: HTMLVideoElement; flipY: boolean },
      destination: { texture: GpuTexture },
      copySize: [number, number],
    ): void;
  };
  createShaderModule(descriptor: { code: string }): unknown;
  createSampler(descriptor?: { magFilter?: string; minFilter?: string }): unknown;
  createBuffer(descriptor: { size: number; usage: number }): GpuBuffer;
  createTexture(descriptor: {
    size: [number, number];
    format: string;
    usage: number;
  }): GpuTexture;
  createBindGroup(descriptor: { layout: unknown; entries: { binding: number; resource: unknown }[] }): unknown;
  createRenderPipeline(descriptor: unknown): { getBindGroupLayout(index: number): unknown };
  createCommandEncoder(): {
    beginRenderPass(descriptor: unknown): {
      setPipeline(pipeline: unknown): void;
      setBindGroup(index: number, group: unknown): void;
      draw(count: number): void;
      end(): void;
    };
    copyTextureToTexture(source: unknown, destination: unknown, size: [number, number]): void;
    finish(): unknown;
  };
}

interface GpuAdapter {
  requestDevice(): Promise<GpuDevice>;
}

interface GpuFactory {
  requestAdapter(): Promise<GpuAdapter | null>;
  getPreferredCanvasFormat(): string;
}

interface GpuCanvasContext {
  configure(descriptor: { device: GpuDevice; format: string; alphaMode: 'opaque' }): void;
  getCurrentTexture(): GpuTexture;
}

function gpuFactory(): GpuFactory | null {
  const candidate = (navigator as Navigator & { gpu?: GpuFactory }).gpu;
  return candidate ?? null;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

class WebGlPreview {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly texture: WebGLTexture;
  private readonly buffer: WebGLBuffer;
  private width = 0;
  private height = 0;

  private constructor(gl: WebGL2RenderingContext, program: WebGLProgram, texture: WebGLTexture, buffer: WebGLBuffer) {
    this.gl = gl;
    this.program = program;
    this.texture = texture;
    this.buffer = buffer;
  }

  static create(canvas: HTMLCanvasElement): WebGlPreview | null {
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, alpha: false });
    if (!gl) return null;
    const vertex = compileShader(gl, gl.VERTEX_SHADER, WEBGL_VERTEX_SHADER);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, WEBGL_FRAGMENT_SHADER);
    if (!vertex || !fragment) return null;
    const program = gl.createProgram();
    const texture = gl.createTexture();
    const buffer = gl.createBuffer();
    if (!program || !texture || !buffer) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    return new WebGlPreview(gl, program, texture, buffer);
  }

  draw(video: HTMLVideoElement, grade: PreviewGrade): boolean {
    const gl = this.gl;
    if (gl.isContextLost() || video.readyState < 2 || video.videoWidth < 2) return false;
    const scale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(2, Math.round(video.videoWidth * scale));
    const height = Math.max(2, Math.round(video.videoHeight * scale));
    if (this.width !== width || this.height !== height) {
      this.width = width;
      this.height = height;
      gl.canvas.width = width;
      gl.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(this.program);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } catch {
      return false;
    }
    const uniform = (name: string) => gl.getUniformLocation(this.program, name);
    gl.uniform1f(uniform('u_exposure'), grade.exposure);
    gl.uniform1f(uniform('u_contrast'), grade.contrast);
    gl.uniform1f(uniform('u_saturation'), grade.saturation);
    gl.uniform1f(uniform('u_temperature'), grade.temperature);
    gl.uniform1f(uniform('u_tint'), grade.tint);
    gl.uniform1f(uniform('u_highlights'), grade.highlights);
    gl.uniform1f(uniform('u_shadows'), grade.shadows);
    gl.uniform1f(uniform('u_blur'), grade.blur);
    gl.uniform2f(uniform('u_texel'), 1 / width, 1 / height);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.texture);
    gl.deleteBuffer(this.buffer);
    gl.deleteProgram(this.program);
  }
}

class WebGpuPreview {
  private readonly device: GpuDevice;
  private readonly context: GpuCanvasContext;
  private readonly canvas: HTMLCanvasElement;
  private readonly pipeline: { getBindGroupLayout(index: number): unknown };
  private readonly sampler: unknown;
  private readonly uniform: GpuBuffer;
  private texture: GpuTexture | null = null;
  private width = 0;
  private height = 0;

  private constructor(
    device: GpuDevice,
    context: GpuCanvasContext,
    canvas: HTMLCanvasElement,
    pipeline: { getBindGroupLayout(index: number): unknown },
    sampler: unknown,
    uniform: GpuBuffer,
  ) {
    this.device = device;
    this.context = context;
    this.canvas = canvas;
    this.pipeline = pipeline;
    this.sampler = sampler;
    this.uniform = uniform;
  }

  static async create(canvas: HTMLCanvasElement): Promise<WebGpuPreview | null> {
    const gpu = gpuFactory();
    if (!gpu) return null;
    try {
      const adapter = await gpu.requestAdapter();
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      const context = canvas.getContext('webgpu') as GpuCanvasContext | null;
      if (!context) return null;
      const format = gpu.getPreferredCanvasFormat();
      context.configure({ device, format, alphaMode: 'opaque' });
      const module = device.createShaderModule({ code: WEBGPU_SHADER });
      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      });
      const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
      const uniform = device.createBuffer({ size: 48, usage: 0x40 | 0x08 });
      return new WebGpuPreview(device, context, canvas, pipeline, sampler, uniform);
    } catch {
      return null;
    }
  }

  draw(video: HTMLVideoElement, grade: PreviewGrade): boolean {
    if (video.readyState < 2 || video.videoWidth < 2) return false;
    const scale = Math.min(1, MAX_PREVIEW_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(2, Math.round(video.videoWidth * scale));
    const height = Math.max(2, Math.round(video.videoHeight * scale));
    if (!this.texture || this.width !== width || this.height !== height) {
      this.texture?.destroy();
      this.width = width;
      this.height = height;
      this.canvas.width = width;
      this.canvas.height = height;
      this.texture = this.device.createTexture({
        size: [width, height],
        format: 'rgba8unorm',
        usage: 0x02 | 0x04,
      });
    }
    const source = this.texture;
    if (!source) return false;
    try {
      this.device.queue.copyExternalImageToTexture(
        { source: video, flipY: false },
        { texture: source },
        [width, height],
      );
      const packed = new Float32Array([
        grade.exposure,
        grade.contrast,
        grade.saturation,
        grade.temperature,
        grade.tint,
        grade.highlights,
        grade.shadows,
        grade.blur,
        1 / width,
        1 / height,
        0,
        0,
      ]);
      this.device.queue.writeBuffer(this.uniform, 0, packed);
      const bind = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.sampler },
          { binding: 1, resource: source.createView() },
          { binding: 2, resource: { buffer: this.uniform } },
        ],
      });
      const encoder = this.device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{
          view: this.context.getCurrentTexture().createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        }],
      });
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, bind);
      pass.draw(3);
      pass.end();
      this.device.queue.submit([encoder.finish()]);
      return true;
    } catch {
      return false;
    }
  }

  dispose(): void {
    this.texture?.destroy();
    this.uniform.destroy();
  }
}

export type PreviewDrawOutcome = 'pending' | 'drawn' | 'failed';

/** A frame that has not decoded yet is not a GPU failure. Three real failures drop to CSS. */
export function nextPreviewAttempt(
  failures: number,
  outcome: PreviewDrawOutcome,
): { failures: number; abandon: boolean } {
  if (outcome === 'pending') return { failures, abandon: false };
  if (outcome === 'drawn') return { failures: 0, abandon: false };
  const next = failures + 1;
  return { failures: next, abandon: next >= 3 };
}

export class PreviewSession {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGlPreview | null = null;
  private gpu: WebGpuPreview | null = null;
  private backend: PreviewBackend = 'css';
  private failures = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  get active(): PreviewBackend {
    return this.backend;
  }

  async start(): Promise<PreviewBackend> {
    const gpuCaps = gpuFactory() !== null;
    const glCaps = Boolean(this.canvas.getContext);
    const preferred = selectPreviewBackend({ webgpu: gpuCaps, webgl2: glCaps });
    if (preferred === 'webgpu') {
      this.gpu = await WebGpuPreview.create(this.canvas);
      if (this.gpu) {
        this.backend = 'webgpu';
        return this.backend;
      }
    }
    if (preferred !== 'css') {
      this.gl = WebGlPreview.create(this.canvas);
      if (this.gl) {
        this.backend = 'webgl2';
        return this.backend;
      }
    }
    this.backend = 'css';
    return this.backend;
  }

  draw(video: HTMLVideoElement, grade: PreviewGrade): boolean {
    if (this.backend === 'css') return false;
    const pending = video.readyState < 2 || video.videoWidth < 2;
    const drew = pending
      ? false
      : this.backend === 'webgpu'
        ? this.gpu?.draw(video, grade) ?? false
        : this.gl?.draw(video, grade) ?? false;
    const step = nextPreviewAttempt(this.failures, pending ? 'pending' : drew ? 'drawn' : 'failed');
    this.failures = step.failures;
    if (step.abandon) {
      this.dispose();
      this.backend = 'css';
    }
    return drew;
  }

  dispose(): void {
    this.gl?.dispose();
    this.gpu?.dispose();
    this.gl = null;
    this.gpu = null;
  }
}

function placeCanvas(canvas: HTMLCanvasElement, video: HTMLVideoElement): void {
  const parent = canvas.parentElement;
  if (!parent) return;
  const box = video.getBoundingClientRect();
  const host = parent.getBoundingClientRect();
  canvas.style.left = `${box.left - host.left}px`;
  canvas.style.top = `${box.top - host.top}px`;
  canvas.style.width = `${box.width}px`;
  canvas.style.height = `${box.height}px`;
}

/**
 * Composites the program monitor on WebGPU when the browser has an adapter,
 * otherwise WebGL2. Three failed draws, or no context at all, leave the CSS
 * filter path in place.
 */
export function useGpuPreview(
  videoRef: RefObject<HTMLVideoElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  grade: PreviewGrade,
  active: boolean,
): PreviewBackend {
  const gradeRef = useRef(grade);
  const [backend, setBackend] = useState<PreviewBackend>('css');

  useEffect(() => {
    gradeRef.current = grade;
  }, [grade]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!active || !canvas || !video) return;
    const session = new PreviewSession(canvas);
    let disposed = false;
    let frame = 0;
    void session.start().then((chosen) => {
      if (disposed) {
        session.dispose();
        return;
      }
      setBackend(chosen);
      canvas.dataset.previewBackend = chosen;
    });
    const tick = () => {
      const current = videoRef.current;
      if (current) {
        const started = performance.now();
        const drew = session.active !== 'css' && session.draw(current, gradeRef.current);
        if (drew) {
          placeCanvas(canvas, current);
          canvas.dataset.frameMs = (performance.now() - started).toFixed(2);
        }
        if (session.active === 'css' && canvas.dataset.previewBackend !== 'css') {
          setBackend('css');
          canvas.dataset.previewBackend = 'css';
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      session.dispose();
      setBackend('css');
    };
  }, [active, canvasRef, videoRef]);

  return active ? backend : 'css';
}
