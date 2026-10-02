import type { FrameImage } from '$lib/media/frames';
import type { GradeParams } from '$lib/model/moods';
import { frameRect, showsBars, type FrameBars, type Rect } from '$lib/model/framing';
import type { TransitionKind } from '$lib/model/types';
import { compileProgram, createTexture } from './gl';
import type { OverlayDraw } from './overlay';
import type { VisualDraw } from './visuals';

/**
 * The WebGL2 compositor draws one output frame. The same code renders the live preview and,
 * on an offscreen canvas, every frame of an export, so what you see is what you save.
 *
 * Pipeline for one frame:
 *   1. each visible scene frame is drawn "cover"-fitted with its colour mood (grade shader);
 *      during a transition both scenes go to offscreen framebuffers first,
 *   2. the transition shader blends them onto the output,
 *   3. what's on the overlay tracks is drawn on top, lowest track first: pictures with rounded
 *      corners, border, shadow and opacity, and words as sprites with their animation.
 */

export interface LayerInput {
	image: FrameImage;
	width: number;
	height: number;
	grade: GradeParams;
	/** Where the picture goes, in output pixels (top-left origin). See `frameRect`. */
	rect: Rect;
	/** What fills the frame around the picture if it doesn't cover it. */
	bars: FrameBars;
	/** Part of the image to use (crop), as u, v (bottom-left), width, height in 0–1. */
	uv: [number, number, number, number];
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
	/** Entrance animation scale, times the drawn sprite's own (1 / its sharpness factor). */
	scale: number;
	/** Keyframed scale (missing = 1). */
	scaleX?: number;
	scaleY?: number;
	/** Radians, clockwise (missing = 0). */
	rotation?: number;
	opacity: number;
}

export interface CompositeFrame {
	/** The scene showing (or the outgoing scene during a transition). */
	a: LayerInput | null;
	/** The incoming scene during a transition. */
	b?: LayerInput | null;
	transition?: { kind: TransitionKind; progress: number } | null;
	/** Overlay tracks' pictures and words, in drawing order (lowest track first). */
	visuals?: VisualDraw[];
}

export const TRANSITION_IDS: Record<TransitionKind, number> = {
	cut: 0,
	crossfade: 1,
	'fade-black': 2,
	slide: 3,
	zoom: 4
};

/** A textured rectangle: uRect = x, y (bottom-left, clip space), width, height (clip units). */
const RECT_VS = /* glsl */ `#version 300 es
in vec2 aPos;
uniform vec4 uRect;
out vec2 vUv;
void main() {
	vec2 p = aPos * 0.5 + 0.5;
	vUv = p;
	gl_Position = vec4(uRect.xy + p * uRect.zw, 0.0, 1.0);
}`;

/** A scene's picture: like RECT_VS, but samples only the cropped part of the texture. */
const LAYER_VS = /* glsl */ `#version 300 es
in vec2 aPos;
uniform vec4 uRect;
uniform vec4 uCrop;
out vec2 vUv;
void main() {
	vec2 p = aPos * 0.5 + 0.5;
	vUv = uCrop.xy + p * uCrop.zw;
	gl_Position = vec4(uRect.xy + p * uRect.zw, 0.0, 1.0);
}`;

/** Soft blur for "blurred bars": a 9-tap tent filter over a heavily downscaled copy. */
const BLUR_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uImage;
uniform vec2 uTexel;
out vec4 outColor;
void main() {
	vec3 c = vec3(0.0);
	float total = 0.0;
	for (int i = -1; i <= 1; i++) {
		for (int j = -1; j <= 1; j++) {
			float w = (2.0 - abs(float(i))) * (2.0 - abs(float(j)));
			c += texture(uImage, vUv + vec2(float(i), float(j)) * uTexel * 1.5).rgb * w;
			total += w;
		}
	}
	outColor = vec4(c / total * 0.85, 1.0);
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

/** Words: a quad of half-size uHalf around uCenter (output pixels, y down), turned by uRotation. */
const SPRITE_VS = /* glsl */ `#version 300 es
in vec2 aPos;
uniform vec2 uViewport;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform vec2 uRotation; // cos, sin (clockwise on screen)
uniform vec3 uView; // where the frame is on this canvas: offset x, y and scale (see renderPasteboard)
out vec2 vUv;
void main() {
	vUv = vec2(aPos.x * 0.5 + 0.5, aPos.y * 0.5 + 0.5);
	vec2 local = vec2(aPos.x, -aPos.y) * uHalf;
	vec2 px = uCenter + vec2(local.x * uRotation.x - local.y * uRotation.y, local.x * uRotation.y + local.y * uRotation.x);
	px = uView.xy + px * uView.z;
	gl_Position = vec4(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0, 0.0, 1.0);
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

/**
 * An overlay: a quad around its box (grown to fit the shadow), with the box as a rounded
 * rectangle. Everything is worked out per pixel from a signed distance to the box's edge, so
 * corners, border and shadow are smooth at any size. Positions are in output pixels, y down.
 */
const OVERLAY_VS = /* glsl */ `#version 300 es
in vec2 aPos;
uniform vec2 uViewport;
uniform vec2 uCenter;
uniform vec2 uHalf;
uniform float uMargin;
uniform vec2 uRotation; // cos, sin (clockwise on screen)
uniform vec3 uView; // where the frame is on this canvas: offset x, y and scale (see renderPasteboard)
out vec2 vLocal;
void main() {
	vLocal = aPos * (uHalf + vec2(uMargin));
	vec2 px = uCenter + vec2(vLocal.x * uRotation.x - vLocal.y * uRotation.y, vLocal.x * uRotation.y + vLocal.y * uRotation.x);
	px = uView.xy + px * uView.z;
	gl_Position = vec4(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0, 0.0, 1.0);
}`;

const OVERLAY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
uniform vec2 uHalf;
uniform float uRadius;
uniform float uBorder;
uniform vec3 uBorderColor;
uniform float uShadowBlur;
uniform vec2 uShadowOffset;
uniform float uShadowAlpha;
uniform float uOpacity;
uniform sampler2D uImage;
uniform vec4 uUv;
uniform vec3 uGain;
uniform vec3 uLift;
uniform float uContrast;
uniform float uSaturation;
out vec4 outColor;

float roundedBox(vec2 p, vec2 half_, float r) {
	vec2 q = abs(p) - half_ + vec2(r);
	return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec3 graded(vec3 c) {
	c *= uGain;
	c = (c - 0.5) * uContrast + 0.5;
	float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
	c = mix(vec3(luma), c, uSaturation);
	c = uLift + c * (1.0 - uLift);
	return clamp(c, 0.0, 1.0);
}

void main() {
	float d = roundedBox(vLocal, uHalf, uRadius);
	float box = clamp(0.5 - d, 0.0, 1.0);
	vec2 innerHalf = max(uHalf - vec2(uBorder), vec2(0.5));
	float di = roundedBox(vLocal, innerHalf, max(uRadius - uBorder, 0.0));
	float picture = uBorder > 0.0 ? clamp(0.5 - di, 0.0, 1.0) : 1.0;
	// 0–1 across the picture area, y down; textures are stored bottom-up.
	vec2 t = clamp(vLocal / innerHalf * 0.5 + 0.5, 0.0, 1.0);
	vec4 image = texture(uImage, uUv.xy + vec2(t.x, 1.0 - t.y) * uUv.zw);
	vec3 c = graded(image.rgb);
	// The picture keeps its own transparency (a PNG with a transparent background); the border
	// is solid. Premultiplied.
	float a = mix(1.0, image.a, picture);
	vec4 front = vec4(mix(uBorderColor, c, picture) * a, a) * box;
	float shadow = 0.0;
	if (uShadowAlpha > 0.0) {
		float ds = roundedBox(vLocal - uShadowOffset, uHalf, uRadius);
		shadow = uShadowAlpha * (1.0 - smoothstep(-uShadowBlur * 0.5, uShadowBlur, ds));
	}
	// Premultiplied: the box over its shadow, then the overlay's opacity.
	outColor = (front + vec4(0.0, 0.0, 0.0, shadow) * (1.0 - front.a)) * uOpacity;
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
		u: Uniforms<'rect' | 'crop' | 'image' | 'gain' | 'lift' | 'contrast' | 'saturation'>;
	};
	private transition!: {
		program: WebGLProgram;
		u: Uniforms<'rect' | 'a' | 'b' | 'kind' | 'progress'>;
	};
	private blur!: { program: WebGLProgram; u: Uniforms<'rect' | 'image' | 'texel'> };
	private sprite!: {
		program: WebGLProgram;
		u: Uniforms<'viewport' | 'view' | 'center' | 'half' | 'rotation' | 'opacity' | 'image'>;
	};
	private overlay!: {
		program: WebGLProgram;
		u: Uniforms<
			| 'viewport'
			| 'view'
			| 'center'
			| 'half'
			| 'rotation'
			| 'margin'
			| 'radius'
			| 'border'
			| 'borderColor'
			| 'shadowBlur'
			| 'shadowOffset'
			| 'shadowAlpha'
			| 'opacity'
			| 'image'
			| 'uv'
			| 'gain'
			| 'lift'
			| 'contrast'
			| 'saturation'
		>;
	};
	private slots: TextureSlot[] = [];
	private targets: Target[] = [];
	private spriteTextures = new Map<string, { texture: WebGLTexture; used: number }>();
	private frameCount = 0;
	lost = false;

	/**
	 * Where frame pixels go on this canvas (x, y, scale) and how much visuals are faded: the
	 * identity and 1, except while drawing the editor's pasteboard.
	 */
	private view: [number, number, number] = [0, 0, 1];
	private fade = 1;

	/** Clear to transparent (not black) where nothing is drawn: "Overlays only" exports. */
	private readonly transparent: boolean;

	constructor(
		readonly canvas: HTMLCanvasElement | OffscreenCanvas,
		options: { transparent?: boolean } = {}
	) {
		this.transparent = !!options.transparent;
		const gl = canvas.getContext('webgl2', {
			// Overlays are drawn premultiplied, so a transparent canvas keeps them exact.
			alpha: this.transparent,
			antialias: false,
			premultipliedAlpha: this.transparent,
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

	/** The GPU's largest texture side: text sprites are drawn no larger than this. */
	maxTextureSize = 4096;

	private init() {
		const gl = this.gl;
		this.maxTextureSize = Math.max(2048, (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number) || 4096);
		this.grade = this.program(LAYER_VS, GRADE_FS, {
			rect: 'uRect',
			crop: 'uCrop',
			image: 'uImage',
			gain: 'uGain',
			lift: 'uLift',
			contrast: 'uContrast',
			saturation: 'uSaturation'
		});
		this.transition = this.program(RECT_VS, TRANSITION_FS, {
			rect: 'uRect',
			a: 'uA',
			b: 'uB',
			kind: 'uKind',
			progress: 'uProgress'
		});
		this.blur = this.program(RECT_VS, BLUR_FS, { rect: 'uRect', image: 'uImage', texel: 'uTexel' });
		this.sprite = this.program(SPRITE_VS, SPRITE_FS, {
			viewport: 'uViewport',
			view: 'uView',
			center: 'uCenter',
			half: 'uHalf',
			rotation: 'uRotation',
			opacity: 'uOpacity',
			image: 'uImage'
		});

		this.overlay = this.program(OVERLAY_VS, OVERLAY_FS, {
			viewport: 'uViewport',
			view: 'uView',
			center: 'uCenter',
			half: 'uHalf',
			rotation: 'uRotation',
			margin: 'uMargin',
			radius: 'uRadius',
			border: 'uBorder',
			borderColor: 'uBorderColor',
			shadowBlur: 'uShadowBlur',
			shadowOffset: 'uShadowOffset',
			shadowAlpha: 'uShadowAlpha',
			opacity: 'uOpacity',
			image: 'uImage',
			uv: 'uUv',
			gain: 'uGain',
			lift: 'uLift',
			contrast: 'uContrast',
			saturation: 'uSaturation'
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

	/**
	 * WebGL ignores UNPACK_FLIP_Y_WEBGL for ImageBitmaps (photos), which would draw them upside
	 * down. Such an image is copied once into a canvas, which is flipped like every other source.
	 */
	private readonly uprightCopies = new WeakMap<ImageBitmap, OffscreenCanvas>();

	private uploadable(image: FrameImage): TexImageSource {
		if (typeof ImageBitmap === 'undefined' || !(image instanceof ImageBitmap)) return image;
		let copy = this.uprightCopies.get(image);
		if (!copy) {
			copy = new OffscreenCanvas(image.width, image.height);
			copy.getContext('2d')!.drawImage(image, 0, 0);
			this.uprightCopies.set(image, copy);
		}
		return copy;
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
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.uploadable(image));
			slot.source = image;
		}
	}

	/** An offscreen framebuffer (the size of the output unless given), reused between frames. */
	private target(index: number, width = this.canvas.width, height = this.canvas.height): Target {
		const gl = this.gl;
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
			gl.uniform4f(u.rect, -1, -1, 2, 2);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
			gl.activeTexture(gl.TEXTURE0);
		} else if (frame.a || frame.b) {
			// One scene on its own, or (as a last resort) whichever side of a transition has a
			// picture: never black because the other one's frame is missing.
			this.drawLayer((frame.a ?? frame.b)!, 0, null);
		} else {
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.clearColor(0, 0, 0, this.transparent ? 0 : 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
		}

		this.drawVisuals(frame.visuals ?? []);
		gl.bindVertexArray(null);
	}

	/**
	 * The editor's pasteboard (a transparent canvas behind the frame, covering the stage): only
	 * the given pictures and words, faded by `fade`, with a frame pixel p drawn at
	 * view.x + p × view.scale here. The frame itself (drawn by the preview's own compositor) covers
	 * the middle, so what shows is the parts outside it. Never used for Watch or saving.
	 */
	renderPasteboard(visuals: VisualDraw[], view: { x: number; y: number; scale: number }, fade: number): void {
		if (this.lost) return;
		const gl = this.gl;
		this.frameCount++;
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.bindVertexArray(this.quad);
		this.view = [view.x, view.y, view.scale];
		this.fade = fade;
		try {
			this.drawVisuals(visuals);
		} finally {
			this.view = [0, 0, 1];
			this.fade = 1;
			gl.bindVertexArray(null);
		}
	}

	/** Texture slots for overlays start after the scenes' (0, 1). */
	private static readonly OVERLAY_SLOT = 8;

	/** Pictures and words from the overlay tracks, in order, blended onto the frame. */
	private drawVisuals(visuals: VisualDraw[]) {
		if (visuals.length === 0) return;
		const gl = this.gl;
		const { width: W, height: H } = this.canvas;
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, W, H);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		let slot = 0;
		for (const v of visuals) {
			if (v.type === 'overlay') this.drawOverlay(v.draw, Compositor.OVERLAY_SLOT + slot++);
			else this.drawText(v.draw);
		}
		gl.disable(gl.BLEND);
		this.evictSprites();
	}

	private drawOverlay(o: OverlayDraw, slot: number) {
		if (o.opacity <= 0.001 || o.rect.w < 1 || o.rect.h < 1) return;
		const gl = this.gl;
		const { width: W, height: H } = this.canvas;
		const { program, u } = this.overlay;
		gl.useProgram(program);
		gl.uniform2f(u.viewport, W, H);
		gl.uniform3f(u.view, ...this.view);
		gl.uniform1i(u.image, 0);
		this.bindImage(slot, o.image);
		const s = o.shadow;
		gl.uniform2f(u.center, o.rect.x + o.rect.w / 2, o.rect.y + o.rect.h / 2);
		const cos = Math.cos(o.rotation ?? 0);
		const sin = Math.sin(o.rotation ?? 0);
		gl.uniform2f(u.rotation, cos, sin);
		gl.uniform2f(u.half, o.rect.w / 2, o.rect.h / 2);
		gl.uniform1f(u.margin, s ? s.blur + Math.hypot(s.offsetX, s.offsetY) + 2 : 1);
		gl.uniform1f(u.radius, Math.min(o.radius, o.rect.w / 2, o.rect.h / 2));
		gl.uniform1f(u.border, o.borderWidth);
		gl.uniform3f(u.borderColor, ...o.borderColor);
		gl.uniform1f(u.shadowBlur, s ? Math.max(1, s.blur) : 1);
		// The shadow falls down the screen whichever way the overlay is turned: its offset is
		// given in the overlay's own (turned) space.
		const ox = s?.offsetX ?? 0;
		const oy = s?.offsetY ?? 0;
		gl.uniform2f(u.shadowOffset, ox * cos + oy * sin, -ox * sin + oy * cos);
		gl.uniform1f(u.shadowAlpha, s?.alpha ?? 0);
		gl.uniform1f(u.opacity, o.opacity * this.fade);
		gl.uniform4f(u.uv, ...o.uv);
		const g = o.grade;
		gl.uniform3f(u.gain, g.gain[0], g.gain[1], g.gain[2]);
		gl.uniform3f(u.lift, g.lift[0], g.lift[1], g.lift[2]);
		gl.uniform1f(u.contrast, g.contrast);
		gl.uniform1f(u.saturation, g.saturation);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}

	/** A pixel rectangle (top-left origin) as uRect in clip space for a W × H target. */
	private static clipRect(r: Rect, W: number, H: number): [number, number, number, number] {
		return [(r.x / W) * 2 - 1, 1 - ((r.y + r.h) / H) * 2, (r.w / W) * 2, (r.h / H) * 2];
	}

	private drawGraded(layer: LayerInput, rect: Rect, W: number, H: number) {
		const gl = this.gl;
		const { u } = this.grade;
		gl.useProgram(this.grade.program);
		gl.uniform1i(u.image, 0);
		gl.uniform4f(u.rect, ...Compositor.clipRect(rect, W, H));
		gl.uniform4f(u.crop, ...layer.uv);
		const g = layer.grade;
		gl.uniform3f(u.gain, g.gain[0], g.gain[1], g.gain[2]);
		gl.uniform3f(u.lift, g.lift[0], g.lift[1], g.lift[2]);
		gl.uniform1f(u.contrast, g.contrast);
		gl.uniform1f(u.saturation, g.saturation);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}

	/**
	 * Draw one scene frame into `fbo` (null = the screen): the bars (black, white or a blurred
	 * copy of the picture) and then the picture at its framing rectangle, colour graded.
	 */
	private drawLayer(layer: LayerInput, slot: number, fbo: WebGLFramebuffer | null) {
		const gl = this.gl;
		const { width: W, height: H } = this.canvas;
		this.bindImage(slot, layer.image);
		const bars = showsBars(layer.rect, W, H);

		if (bars && layer.bars === 'blur') {
			// A small cover-fitted copy, then scaled up through a blur.
			const sw = Math.max(16, Math.round(W / 12));
			const sh = Math.max(16, Math.round(H / 12));
			const small = this.target(2 + slot, sw, sh);
			gl.bindFramebuffer(gl.FRAMEBUFFER, small.fbo);
			gl.viewport(0, 0, sw, sh);
			const cw = layer.width * layer.uv[2];
			const ch = layer.height * layer.uv[3];
			this.drawGraded(layer, frameRect(undefined, cw, ch, sw, sh), sw, sh);
			gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
			gl.viewport(0, 0, W, H);
			gl.useProgram(this.blur.program);
			gl.bindTexture(gl.TEXTURE_2D, small.texture);
			gl.uniform1i(this.blur.u.image, 0);
			gl.uniform2f(this.blur.u.texel, 1 / sw, 1 / sh);
			gl.uniform4f(this.blur.u.rect, -1, -1, 2, 2);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
			this.bindImage(slot, layer.image);
		} else {
			gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
			gl.viewport(0, 0, W, H);
			const white = bars && layer.bars === 'white' ? 1 : 0;
			gl.clearColor(white, white, white, 1);
			gl.clear(gl.COLOR_BUFFER_BIT);
		}
		this.drawGraded(layer, layer.rect, W, H);
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

	private drawText(t: TextDraw) {
		if (t.opacity <= 0.001) return;
		const gl = this.gl;
		const { width: W, height: H } = this.canvas;
		const { program, u } = this.sprite;
		gl.useProgram(program);
		gl.activeTexture(gl.TEXTURE0);
		gl.uniform1i(u.image, 0);
		gl.bindTexture(gl.TEXTURE_2D, this.spriteTexture(t.key, t.image));
		gl.uniform2f(u.viewport, W, H);
		gl.uniform3f(u.view, ...this.view);
		gl.uniform2f(u.center, t.cx, t.cy);
		gl.uniform2f(u.half, (t.width * t.scale * (t.scaleX ?? 1)) / 2, (t.height * t.scale * (t.scaleY ?? 1)) / 2);
		const r = t.rotation ?? 0;
		gl.uniform2f(u.rotation, Math.cos(r), Math.sin(r));
		gl.uniform1f(u.opacity, t.opacity * this.fade);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
		// Both lists can have gaps (e.g. only the small blur buffers exist).
		for (const slot of this.slots) if (slot) gl.deleteTexture(slot.texture);
		for (const t of this.targets) {
			if (!t) continue;
			gl.deleteFramebuffer(t.fbo);
			gl.deleteTexture(t.texture);
		}
		for (const entry of this.spriteTextures.values()) gl.deleteTexture(entry.texture);
		this.slots = [];
		this.targets = [];
		this.spriteTextures.clear();
		gl.deleteProgram(this.grade.program);
		gl.deleteProgram(this.transition.program);
		gl.deleteProgram(this.blur.program);
		gl.deleteProgram(this.sprite.program);
		gl.deleteProgram(this.overlay.program);
	}
}
