import type { FrameImage } from '$lib/media/frames';
import { compileProgram, coverScale, createTexture } from './gl';

/**
 * The WebGL2 compositor draws one output frame. The same code renders the live preview and,
 * on an offscreen canvas, every frame of an export, so what you see is what you save.
 */

export interface LayerInput {
	image: FrameImage;
	width: number;
	height: number;
}

export interface CompositeFrame {
	/** The scene showing (or the outgoing scene during a transition). */
	layer: LayerInput | null;
}

const QUAD_VS = /* glsl */ `#version 300 es
in vec2 aPos;
uniform vec2 uScale;
out vec2 vUv;
void main() {
	vUv = aPos * 0.5 + 0.5;
	gl_Position = vec4(aPos * uScale, 0.0, 1.0);
}`;

const IMAGE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uImage;
out vec4 outColor;
void main() {
	outColor = vec4(texture(uImage, vUv).rgb, 1.0);
}`;

interface TextureSlot {
	texture: WebGLTexture;
	source: FrameImage | null;
}

export class Compositor {
	private gl: WebGL2RenderingContext;
	private imageProgram!: WebGLProgram;
	private quad!: WebGLVertexArrayObject;
	private slots: TextureSlot[] = [];
	private uScale!: WebGLUniformLocation;
	lost = false;

	constructor(readonly canvas: HTMLCanvasElement | OffscreenCanvas) {
		const gl = canvas.getContext('webgl2', {
			alpha: false,
			antialias: false,
			premultipliedAlpha: false,
			preserveDrawingBuffer: true,
			powerPreference: 'high-performance'
		}) as WebGL2RenderingContext | null;
		if (!gl) throw new Error('WebGL2 is not available');
		this.gl = gl;
		this.init();

		if ('addEventListener' in canvas) {
			canvas.addEventListener('webglcontextlost', (e) => {
				e.preventDefault();
				this.lost = true;
			});
			canvas.addEventListener('webglcontextrestored', () => {
				this.slots = [];
				this.init();
				this.lost = false;
			});
		}
	}

	private init() {
		const gl = this.gl;
		this.imageProgram = compileProgram(gl, QUAD_VS, IMAGE_FS);
		this.uScale = gl.getUniformLocation(this.imageProgram, 'uScale')!;

		this.quad = gl.createVertexArray()!;
		gl.bindVertexArray(this.quad);
		const buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
		const loc = gl.getAttribLocation(this.imageProgram, 'aPos');
		gl.enableVertexAttribArray(loc);
		gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
		gl.bindVertexArray(null);

		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
	}

	/** Upload `image` into texture slot `index` unless it's already there. */
	private bindImage(index: number, image: FrameImage): WebGLTexture {
		const gl = this.gl;
		let slot = this.slots[index];
		if (!slot) {
			slot = { texture: createTexture(gl), source: null };
			this.slots[index] = slot;
		}
		gl.activeTexture(gl.TEXTURE0 + index);
		gl.bindTexture(gl.TEXTURE_2D, slot.texture);
		if (slot.source !== image) {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
			slot.source = image;
		}
		return slot.texture;
	}

	resize(width: number, height: number): void {
		if (this.canvas.width !== width || this.canvas.height !== height) {
			this.canvas.width = width;
			this.canvas.height = height;
		}
	}

	render(frame: CompositeFrame): void {
		if (this.lost) return;
		const gl = this.gl;
		const { width, height } = this.canvas;
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, width, height);
		gl.clearColor(0, 0, 0, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);

		const layer = frame.layer;
		if (!layer) return;
		gl.useProgram(this.imageProgram);
		this.bindImage(0, layer.image);
		gl.uniform1i(gl.getUniformLocation(this.imageProgram, 'uImage'), 0);
		const [sx, sy] = coverScale(layer.width / layer.height, width / height);
		gl.uniform2f(this.uScale, sx, sy);
		gl.bindVertexArray(this.quad);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		gl.bindVertexArray(null);
	}

	/** Read one pixel (0–255 RGBA) from the last frame. Used by tests. */
	readPixel(x: number, y: number): [number, number, number, number] {
		const gl = this.gl;
		const out = new Uint8Array(4);
		gl.readPixels(x, this.canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
		return [out[0], out[1], out[2], out[3]];
	}

	dispose(): void {
		const gl = this.gl;
		for (const slot of this.slots) gl.deleteTexture(slot.texture);
		this.slots = [];
		gl.deleteProgram(this.imageProgram);
	}
}
