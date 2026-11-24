/**
 * The Minecraft title-screen panorama: six screenshots (panorama_0..5 = front, right, back,
 * left, up, down) drawn as the inside of a cube around the camera, slowly turning.
 *
 * WebGL, because CSS 3D cubes break when the camera sits inside them: browsers drop faces
 * that cross the camera plane. Here a full-screen shader works out, for every pixel, which
 * way it looks and which face and spot of the screenshots that direction lands on.
 */

const VERT = `
attribute vec2 pos;
varying vec2 vPos;
void main() { vPos = pos; gl_Position = vec4(pos, 0.0, 1.0); }`;

// The six faces sit in a 3 x 2 atlas: 0 1 2 / 3 4 5.
const FRAG = `
precision highp float;
varying vec2 vPos;
uniform sampler2D atlas;
uniform float yaw, pitch, tanHalf, aspect, inset;

vec2 cell(float face, vec2 uv) {
  uv = clamp(uv, inset, 1.0 - inset); // keep away from the neighbouring face in the atlas
  return (vec2(mod(face, 3.0), floor(face / 3.0)) + uv) / vec2(3.0, 2.0);
}

void main() {
  // The ray for this pixel, camera looking along +z, y up, x right.
  vec3 d = normalize(vec3(vPos.x * tanHalf * aspect, vPos.y * tanHalf, 1.0));
  float cp = cos(pitch), sp = sin(pitch);
  d = vec3(d.x, d.y * cp + d.z * sp, -d.y * sp + d.z * cp);
  float cy = cos(yaw), sy = sin(yaw);
  d = vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy);

  vec3 a = abs(d);
  float face; vec2 uv;
  if (a.z >= a.x && a.z >= a.y) {
    face = d.z > 0.0 ? 0.0 : 2.0;
    uv = vec2((d.z > 0.0 ? d.x : -d.x) / a.z, -d.y / a.z);
  } else if (a.x >= a.y) {
    face = d.x > 0.0 ? 1.0 : 3.0;
    uv = vec2((d.x > 0.0 ? -d.z : d.z) / a.x, -d.y / a.x);
  } else {
    face = d.y > 0.0 ? 4.0 : 5.0;
    uv = vec2(d.x / a.y, (d.y > 0.0 ? d.z : -d.z) / a.y);
  }
  gl_FragColor = texture2D(atlas, cell(face, uv * 0.5 + 0.5));
}`;

/** Returns a canvas that draws itself until removed, or null if WebGL is not available. */
export function panoramaCanvas(faces: HTMLImageElement[]): HTMLCanvasElement | null {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) return null;

  const size = faces[0]!.naturalWidth;
  const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const cellSize = Math.min(size, Math.floor(max / 3));
  const atlas = document.createElement('canvas');
  atlas.width = cellSize * 3;
  atlas.height = cellSize * 2;
  const ctx = atlas.getContext('2d')!;
  faces.forEach((img, i) => ctx.drawImage(img, (i % 3) * cellSize, Math.floor(i / 3) * cellSize, cellSize, cellSize));

  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, atlas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const u = (name: string) => gl.getUniformLocation(prog, name);
  const uYaw = u('yaw');
  const uPitch = u('pitch');
  const uAspect = u('aspect');
  gl.uniform1f(u('tanHalf'), Math.tan((70 * Math.PI) / 360)); // 70 degree vertical view
  gl.uniform1f(u('inset'), 0.5 / cellSize);

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    gl.uniform1f(uAspect, w / h);
  };

  // One turn every 4 minutes, with a slow nod up and down.
  const start = performance.now();
  const frame = (now: number) => {
    if (!canvas.isConnected) return;
    resize();
    const t = (now - start) / 1000;
    const fixed = (window as { __panoramaView?: { yaw: number; pitch: number } }).__panoramaView; // screenshots only
    gl.uniform1f(uYaw, fixed ? (fixed.yaw * Math.PI) / 180 : (t / 240) * Math.PI * 2);
    gl.uniform1f(uPitch, (fixed ? fixed.pitch : -4 + 3 * Math.sin(t / 37)) * (Math.PI / 180));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return canvas;
}

export const PANORAMA_FACES = [0, 1, 2, 3, 4, 5].map((i) => `/bg/panorama/${i}.jpg`);
