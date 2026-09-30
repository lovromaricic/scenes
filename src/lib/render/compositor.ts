import type { FrameImage } from '$lib/media/frames';
import type { GradeParams } from '$lib/model/moods';
import type { TransitionKind } from '$lib/model/types';
import { compileProgram, coverScale, createTexture } from './gl';

/**
 * The WebGL2 compositor draws one output frame. The same code renders the live preview and,
 * on an offscreen canvas, every frame of an export, so what you see is what you save.
 *
 * Pipeline for one frame:
 *   1. each visible scene frame is drawn "cover"-fitted with its colour mood (grade shader);
 *      during a transition both scenes go to offscreen framebuffers first,
 *   2. the transition shader blends them onto the output,
 *   3. text sprites are drawn on top with their animation.
 */

export interface LayerInput {
	image: FrameImage;
	width: number;
	height: number;
	grade: GradeParams;
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
	a: LayerInput | null;
	/** The incoming scene during a transition. */
	b?: LayerInput | null;
	transition?: { kind: TransitionKind; progress: number } | null;
	texts?: TextDraw[];
}

export const TRANSITION_IDS: Record<TransitionKind, number> = {
	cut: 0,
	crossfade: 1,
	'fade-black': 2,
	slide: 3,
	zoom: 4
};

const QUAD_VS = /* glsl */ `#version 300 es
in vec2 aPos;
uniform vec2 uScale;
out vec2 vUv;
void main() {
	vUv = aPos * 0.5 + 0.5;
	gl_Position = vec4(aPos * uScale, 0.0, 1.0);
}`;

const GRADE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uImage;
uniform vec3 uGain;
uniform vec3 uLift;
uniform float uContrast;
uniform float uSaturation;
out vec4 outColor;
void main() {
	vec3 c = texture(uImage, vUv).rgb;
	c *= uGain;
	c = (c - 0.5) * uContrast + 0.5;
	float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
	c = mix(vec3(luma), c, uSaturation);
	c = uLift + c * (1.0 - uLift);
	outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const TRANSITION_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uA;
uniform sampler2D uB;
uniform int uKind;
uniform float uProgress;
out vec4 outColor;

vec3 A(vec2 uv) { return texture(uA, uv).rgb; }
vec3 B(vec2 uv) { return texture(uB, uv).rgb; }

void main() {
	float p = clamp(uProgress, 0.0, 1.0);
	float e = p * p * (3.0 - 2.0 * p); // smoothstep easing
	vec3 c;
	if (uKind == 1) {
		c = mix(A(vUv), B(vUv), e);
	} else if (uKind == 2) {
		// Dip to black: out over the first half, in over the second.
		c = p < 0.5 ? A(vUv) * (1.0 - smoothstep(0.0, 0.5, p)) : B(vUv) * smoothstep(0.5, 1.0, p);
	} else if (uKind == 3) {
		// The next scene pushes the current one out to the left.
		c = vUv.x < 1.0 - e ? A(vUv + vec2(e, 0.0)) : B(vUv - vec2(1.0 - e, 0.0));
	} else if (uKind == 4) {
		// Zoom through: the current scene zooms in and fades as the next settles from slightly large.
		vec2 uvA = (vUv - 0.5) / (1.0 + 0.6 * e) + 0.5;
		vec2 uvB = (vUv - 0.5) / (1.25 - 0.25 * e) + 0.5;
		c = mix(A(uvA), B(uvB), smoothstep(0.25, 0.75, p));
	} else {
		c = p < 0.5 ? A(vUv) : B(vUv);
	}
	outColor = vec4(c, 1.0);
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

interface Target {
	fbo: WebGLFramebuffer;
	texture: WebGLTexture;
	width: number;
	height: number;
}

type Uniforms<K extends string> = Record<K, WebGLUniformLocation>;

export class Compositor {
	private gl: WebGL2RenderingContext;
	private quad!: WebGLVertexArrayObject;
	private grade!: {
		program: WebGLProgram;
		u: Uniforms<'scale' | 'image' | 'gain' | 'lift' | 'contrast' | 'saturation'>;
	};
	private transition!: {
		program: WebGLProgram;
		u: Uniforms<'scale' | 'a' | 'b' | 'kind' | 'progress'>;
	};
	private sprite!: { program: WebGLProgram; u: Uniforms<'rect' | 'opacity' | 'image'> };
	private slots: TextureSlot[] = [];
	private targets: Target[] = [];
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
				this.targets = [];
				this.spriteTextures.clear();
				this.init();
				this.lost = false;
			});
		}
	}

	private program<K extends string>(vs: string, fs: string, names: Record<K, string>) {
		const gl = this.gl;
		const program = compileProgram(gl, vs, fs);
		const u = {} as Uniforms<K>;
		for (const key of Object.keys(names) as K[])
			u[key] = gl.getUniformLocation(program, names[key])!;
		return { program, u };
	}

	private init() {
		const gl = this.gl;
		this.grade = this.program(QUAD_VS, GRADE_FS, {
			scale: 'uScale',
			image: 'uImage',
			gain: 'uGain',
			lift: 'uLift',
			contrast: 'uContrast',
			saturation: 'uSaturation'
		});
		this.transition = this.program(QUAD_VS, TRANSITION_FS, {
			scale: 'uScale',
			a: 'uA',
			b: 'uB',
			kind: 'uKind',
			progress: 'uProgress'
		});
		this.sprite = this.program(SPRITE_VS, SPRITE_FS, {
			rect: 'uRect',
			opacity: 'uOpacity',
			image: 'uImage'
		});

		this.quad = gl.createVertexArray()!;
		gl.bindVertexArray(this.quad);
		const buffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
		gl.bindVertexArray(null);

		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
	}

	/** Upload `image` into texture slot `index` unless it's already there, and bind it. */
	private bindImage(index: number, image: FrameImage): void {
		const gl = this.gl;
		let slot = this.slots[index];
		if (!slot) {
			slot = { texture: createTexture(gl), source: null };
			this.slots[index] = slot;
		}
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, slot.texture);
		if (slot.source !== image) {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
			slot.source = image;
		}
	}

	/** An offscreen framebuffer the size of the output, reused between frames. */
	private target(index: number): Target {
		const gl = this.gl;
		const { width, height } = this.canvas;
		let t = this.targets[index];
		if (t && t.width === width && t.height === height) return t;
		if (t) {
			gl.deleteFramebuffer(t.fbo);
			gl.deleteTexture(t.texture);
		}
		const texture = createTexture(gl);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		const fbo = gl.createFramebuffer()!;
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		t = { fbo, texture, width, height };
		this.targets[index] = t;
		return t;
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
		this.frameCount++;
		gl.viewport(0, 0, width, height);
		gl.bindVertexArray(this.quad);

		const kind = frame.transition?.kind ?? 'cut';
		if (frame.a && frame.b && kind !== 'cut') {
			const ta = this.target(0);
			const tb = this.target(1);
			this.drawLayer(frame.a, 0, ta.fbo);
			this.drawLayer(frame.b, 1, tb.fbo);
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			const { program, u } = this.transition;
			gl.useProgram(program);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, ta.texture);
			gl.activeTexture(gl.TEXTURE1);
			gl.bindTexture(gl.TEXTURE_2D, tb.texture);
			gl.uniform1i(u.a, 0);
			gl.uniform1i(u.b, 1);
			gl.uniform1i(u.kind, TRANSITION_IDS[kind]);
			gl.uniform1f(u.progress, frame.transition!.progress);
			gl.uniform2f(u.scale, 1, 1);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
			gl.activeTexture(gl.TEXTURE0);
		} else if (frame.a) {
			this.drawLayer(frame.a, 0, null);
		} else {
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.clearColor(0, 0, 0, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
		}

		this.drawTexts(frame.texts ?? []);
		gl.bindVertexArray(null);
	}

	/** Draw one scene frame, cover-fitted and colour graded, into `fbo` (null = the screen). */
	private drawLayer(layer: LayerInput, slot: number, fbo: WebGLFramebuffer | null) {
		const gl = this.gl;
		const { width, height } = this.canvas;
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
		gl.clearColor(0, 0, 0, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);
		const { program, u } = this.grade;
		gl.useProgram(program);
		this.bindImage(slot, layer.image);
		gl.uniform1i(u.image, 0);
		const [sx, sy] = coverScale(layer.width / layer.height, width / height);
		gl.uniform2f(u.scale, sx, sy);
		const g = layer.grade;
		gl.uniform3f(u.gain, g.gain[0], g.gain[1], g.gain[2]);
		gl.uniform3f(u.lift, g.lift[0], g.lift[1], g.lift[2]);
		gl.uniform1f(u.contrast, g.contrast);
		gl.uniform1f(u.saturation, g.saturation);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		const { program, u } = this.sprite;
		gl.useProgram(program);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		gl.activeTexture(gl.TEXTURE0);
		gl.uniform1i(u.image, 0);
		for (const t of texts) {
			if (t.opacity <= 0.001) continue;
			gl.bindTexture(gl.TEXTURE_2D, this.spriteTexture(t.key, t.image));
			const w = t.width * t.scale;
			const h = t.height * t.scale;
			const left = t.cx - w / 2;
			const bottom = t.cy + h / 2;
			gl.uniform4f(u.rect, (left / W) * 2 - 1, 1 - (bottom / H) * 2, (w / W) * 2, (h / H) * 2);
			gl.uniform1f(u.opacity, t.opacity);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		}
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

	/** Read one pixel (0–255 RGBA) from the last frame. Used by tests. */
	readPixel(x: number, y: number): [number, number, number, number] {
		const gl = this.gl;
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		const out = new Uint8Array(4);
		gl.readPixels(x, this.canvas.height - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
		return [out[0], out[1], out[2], out[3]];
	}

	dispose(): void {
		const gl = this.gl;
		for (const slot of this.slots) gl.deleteTexture(slot.texture);
		for (const t of this.targets) {
			gl.deleteFramebuffer(t.fbo);
			gl.deleteTexture(t.texture);
		}
		for (const entry of this.spriteTextures.values()) gl.deleteTexture(entry.texture);
		this.slots = [];
		this.targets = [];
		this.spriteTextures.clear();
		gl.deleteProgram(this.grade.program);
		gl.deleteProgram(this.transition.program);
		gl.deleteProgram(this.sprite.program);
	}
}
