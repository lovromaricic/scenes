/** Small WebGL2 helpers. */

export function compileProgram(
	gl: WebGL2RenderingContext,
	vertex: string,
	fragment: string
): WebGLProgram {
	const vs = compileShader(gl, gl.VERTEX_SHADER, vertex);
	const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragment);
	const program = gl.createProgram()!;
	gl.attachShader(program, vs);
	gl.attachShader(program, fs);
	// Every program shares one quad, so its position attribute always lives at location 0.
	gl.bindAttribLocation(program, 0, 'aPos');
	gl.linkProgram(program);
	gl.deleteShader(vs);
	gl.deleteShader(fs);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(program);
		gl.deleteProgram(program);
		throw new Error(`Could not link shader program: ${log}`);
	}
	return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type)!;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(shader);
		gl.deleteShader(shader);
		throw new Error(`Could not compile shader: ${log}`);
	}
	return shader;
}

export function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
	const tex = gl.createTexture()!;
	gl.bindTexture(gl.TEXTURE_2D, tex);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	return tex;
}

/**
 * Scale for a full-screen quad so an image of aspect `imageAspect` covers an output of
 * aspect `outAspect` (the overflow is cropped equally on both sides).
 */
export function coverScale(imageAspect: number, outAspect: number): [number, number] {
	return imageAspect > outAspect ? [imageAspect / outAspect, 1] : [1, outAspect / imageAspect];
}
