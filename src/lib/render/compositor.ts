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

/** A text sprite placed on the frame. Positions are in output pixels (y down). */
export interface TextDraw {
	/** Identifies the sprite so its texture is uploaded only once. */
	key: string;
	image: TexImageSource;
	/** Centre of the sprite. */
	cx: number;
	cy: number;
	width: number;
	height: number;
	scale: number;
	opacity: number;
}

export interface CompositeFrame {
	/** The scene showing (or the outgoing scene during a transition). */
	layer: LayerInput | null;
	texts?: TextDraw[];
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

const SPRITE_VS = /* glsl */ `#version 300 es
in vec2 aPos;
uniform vec4 uRect; // x, y (bottom-left, clip space), width, height (clip units)
out vec2 vUv;
void main() {
	vec2 p = aPos * 0.5 + 0.5;
	vUv = p;
	gl_Position = vec4(uRect.xy + p * uRect.zw, 0.0, 1.0);
}`;

const SPRITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uImage;
uniform float uOpacity;
out vec4 outColor;
void main() {
	outColor = texture(uImage, vUv) * uOpacity; // premultiplied alpha
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
	private spriteProgram!: WebGLProgram;
	private spriteUniforms!: {
		rect: WebGLUniformLocation;
		opacity: WebGLUniformLocation;
		image: WebGLUniformLocation;
	};
	private spriteTextures = new Map<string, { texture: WebGLTexture; used: number }>();
	private frameCount = 0;
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
				this.spriteTextures.clear();
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
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		gl.bindVertexArray(null);

		this.spriteProgram = compileProgram(gl, SPRITE_VS, SPRITE_FS);
		this.spriteUniforms = {
			rect: gl.getUniformLocation(this.spriteProgram, 'uRect')!,
			opacity: gl.getUniformLocation(this.spriteProgram, 'uOpacity')!,
			image: gl.getUniformLocation(this.spriteProgram, 'uImage')!
		};

		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
	}

	private spriteTexture(key: string, image: TexImageSource): WebGLTexture {
		const gl = this.gl;
		let entry = this.spriteTextures.get(key);
		if (!entry) {
			const texture = createTexture(gl);
			gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
			gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
			entry = { texture, used: this.frameCount };
			this.spriteTextures.set(key, entry);
		}
		entry.used = this.frameCount;
		return entry.texture;
	}

	private drawTexts(texts: TextDraw[]) {
		if (texts.length === 0) return;
		const gl = this.gl;
		const { width: W, height: H } = this.canvas;
		gl.useProgram(this.spriteProgram);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		gl.activeTexture(gl.TEXTURE0);
		gl.uniform1i(this.spriteUniforms.image, 0);
		gl.bindVertexArray(this.quad);
		for (const t of texts) {
			if (t.opacity <= 0.001) continue;
			gl.bindTexture(gl.TEXTURE_2D, this.spriteTexture(t.key, t.image));
			const w = t.width * t.scale;
			const h = t.height * t.scale;
			const left = t.cx - w / 2;
			const bottom = t.cy + h / 2;
			gl.uniform4f(
				this.spriteUniforms.rect,
				(left / W) * 2 - 1,
				1 - (bottom / H) * 2,
				(w / W) * 2,
				(h / H) * 2
			);
			gl.uniform1f(this.spriteUniforms.opacity, t.opacity);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		}
		gl.bindVertexArray(null);
		gl.disable(gl.BLEND);
		this.evictSprites();
	}

	/** Free textures for sprites that haven't been drawn for a few seconds. */
	private evictSprites() {
		if (this.spriteTextures.size <= 16) return;
		for (const [key, entry] of this.spriteTextures) {
			if (this.frameCount - entry.used > 180) {
				this.gl.deleteTexture(entry.texture);
				this.spriteTextures.delete(key);
			}
		}
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

		this.frameCount++;
		const layer = frame.layer;
		if (layer) this.drawLayer(layer);
		this.drawTexts(frame.texts ?? []);
	}

	private drawLayer(layer: LayerInput) {
		const gl = this.gl;
		const { width, height } = this.canvas;
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
		for (const entry of this.spriteTextures.values()) gl.deleteTexture(entry.texture);
		this.spriteTextures.clear();
		gl.deleteProgram(this.spriteProgram);
		gl.deleteProgram(this.imageProgram);
	}
}
