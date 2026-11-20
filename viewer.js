// Dựng model GeckoLib (.geo.json) bằng three.js, kèm animation idle, kéo chuột để xoay.
// Tọa độ theo đúng file geo (trục y hướng lên, đơn vị 1/16 khối), mặt trước của boss quay về -Z.
const D = Math.PI / 180;

// [mặt, 4 góc (trái-trên, phải-trên, phải-dưới, trái-dưới) nhìn từ ngoài vào]
function faceCorners(f, x0, y0, z0, x1, y1, z1) {
  return {
    north: [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]],
    south: [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]],
    east: [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]],
    west: [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]],
    up: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]],
    down: [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]],
  }[f];
}
const NORMAL = { north: [0, 0, -1], south: [0, 0, 1], east: [1, 0, 0], west: [-1, 0, 0], up: [0, 1, 0], down: [0, -1, 0] };

// Hình chữ nhật UV (pixel) của từng mặt theo quy ước "box UV" của Bedrock
function boxUV(c, mirror) {
  const [u, v] = c.uv, [w, h, d] = c.size;
  const r = {
    east: [u, v + d, d, h], north: [u + d, v + d, w, h], west: [u + d + w, v + d, d, h],
    south: [u + d + w + d, v + d, w, h], up: [u + d, v, w, d], down: [u + d + w, v, w, d],
  };
  if (mirror) { [r.east, r.west] = [r.west, r.east]; }
  return r;
}

function cubeGeometry(THREE, c, bone, tw, th, ref) {
  const inf = c.inflate ?? bone.inflate ?? 0;
  const [ox, oy, oz] = c.origin, [sx, sy, sz] = c.size;
  const x0 = ox - inf - ref[0], y0 = oy - inf - ref[1], z0 = oz - inf - ref[2];
  const x1 = ox + sx + inf - ref[0], y1 = oy + sy + inf - ref[1], z1 = oz + sz + inf - ref[2];
  const mirror = c.mirror ?? bone.mirror ?? false;
  const boxed = Array.isArray(c.uv) ? boxUV(c, mirror) : null;
  const P = [], N = [], T = [], I = [];
  for (const f of ["north", "south", "east", "west", "up", "down"]) {
    let rect;
    if (boxed) rect = boxed[f];
    else if (c.uv && c.uv[f]) rect = [...c.uv[f].uv, ...(c.uv[f].uv_size || [0, 0])];
    else continue;
    let [u, v, w, h] = rect;
    if (!boxed && (!w || !h)) { w = f === "east" || f === "west" ? sz : sx; h = f === "up" || f === "down" ? sz : sy; }
    let uL = u / tw, uR = (u + w) / tw;
    if (mirror && boxed) [uL, uR] = [uR, uL];
    const vT = 1 - v / th, vB = 1 - (v + h) / th;
    const uvs = [[uL, vT], [uR, vT], [uR, vB], [uL, vB]];
    const base = P.length / 3;
    faceCorners(f, x0, y0, z0, x1, y1, z1).forEach((p, i) => { P.push(...p); N.push(...NORMAL[f]); T.push(...uvs[i]); });
    I.push(base, base + 3, base + 2, base, base + 2, base + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(T, 2));
  g.setIndex(I);
  return g;
}

export function buildModel(THREE, data, texture) {
  const root = new THREE.Group(), bones = {}, base = {};
  const tw = data.geo.w, th = data.geo.h;
  const mat = new THREE.MeshLambertMaterial({ map: texture, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide });
  for (const b of data.geo.bones) {                     // cha luôn đứng trước con trong file geo
    const piv = b.pivot || [0, 0, 0];
    const parent = b.parent ? bones[b.parent] : null;
    const g = new THREE.Group();
    const pp = parent ? base[b.parent].pivot : [0, 0, 0];
    g.position.set(piv[0] - pp[0], piv[1] - pp[1], piv[2] - pp[2]);
    const rot = (b.rotation || [0, 0, 0]).map((x) => x * D);
    g.rotation.order = "ZYX"; g.rotation.set(rot[0], rot[1], rot[2]);
    for (const c of b.cubes || []) {
      const cp = c.rotation ? c.pivot || piv : piv;
      const geom = cubeGeometry(THREE, c, b, tw, th, cp);
      const mesh = new THREE.Mesh(geom, mat);
      if (c.rotation) {
        const w = new THREE.Group();
        w.position.set(cp[0] - piv[0], cp[1] - piv[1], cp[2] - piv[2]);
        w.rotation.order = "ZYX"; w.rotation.set(c.rotation[0] * D, c.rotation[1] * D, c.rotation[2] * D);
        w.add(mesh); g.add(w);
      } else { mesh.position.set(cp[0] - piv[0], cp[1] - piv[1], cp[2] - piv[2]); g.add(mesh); }
    }
    (parent || root).add(g);
    bones[b.name] = g; base[b.name] = { pivot: piv, pos: g.position.clone(), rot: g.rotation.clone() };
  }
  return { root, bones, base };
}

// ---- Animation ----
function val(x, t) {
  if (typeof x === "number") return x;
  try {
    const s = String(x).replace(/math\./gi, "Math.").replace(/query\.anim_time|query\.life_time|q\.anim_time|q\.life_time/g, "t")
      .replace(/variable\.[a-z_0-9]+|v\.[a-z_0-9]+|query\.[a-z_0-9]+|q\.[a-z_0-9]+/gi, "0");
    const r = new Function("Math", "t", "return (" + s + ")")(Math, t);
    return Number.isFinite(r) ? r : 0;
  } catch (e) { return 0; }
}
function vec(k, t) {
  const v = Array.isArray(k) ? k : k && (k.post || k.pre || k.vector);
  return (v || [0, 0, 0]).map((x) => val(x, t));
}
function sample(ch, t, len, loop) {
  if (ch == null) return null;
  if (Array.isArray(ch) || typeof ch !== "object" || ch.vector) return vec(ch, t);
  const ks = Object.keys(ch).map(Number).sort((a, b) => a - b);
  if (!ks.length) return null;
  if (loop && len) t = t % len;
  let i = 0; while (i < ks.length - 1 && ks[i + 1] <= t) i++;
  const a = ks[i], b = ks[Math.min(i + 1, ks.length - 1)];
  const key = (n) => ch[String(n)] ?? ch[n.toFixed(1)] ?? ch[Object.keys(ch).find((k) => Number(k) === n)];
  const A = vec(key(a), t), B = vec(key(b), t);
  const f = b === a || t <= a ? 0 : Math.min(1, (t - a) / (b - a));
  return A.map((x, j) => x + (B[j] - x) * f);
}
export function applyAnim(m, anim, t) {
  for (const n in m.bones) {
    const o = m.bones[n], b = m.base[n];
    o.position.copy(b.pos); o.rotation.copy(b.rot); o.scale.set(1, 1, 1);
  }
  if (!anim || !anim.bones) return;
  for (const n in anim.bones) {
    const o = m.bones[n], b = m.base[n], a = anim.bones[n];
    if (!o) continue;
    const L = anim.animation_length, loop = anim.loop !== false;
    const r = sample(a.rotation, t, L, loop), p = sample(a.position, t, L, loop), s = sample(a.scale, t, L, loop);
    if (r) o.rotation.set(b.rot.x + r[0] * D, b.rot.y + r[1] * D, b.rot.z + r[2] * D);
    if (p) o.position.set(b.pos.x + p[0], b.pos.y + p[1], b.pos.z + p[2]);
    if (s) o.scale.set(s[0] ?? 1, s[1] ?? s[0] ?? 1, s[2] ?? s[0] ?? 1);
  }
}

// ---- Giao diện xem 3D ----
export function createViewer(THREE, host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sun = new THREE.DirectionalLight(0xfff0d0, 1.8); sun.position.set(-40, 80, -60); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
  let cur = null, yaw = 0.5, pitch = 0.15, dist = 5, t0 = performance.now(), run = true, drag = false, last = 0, raf = 0, center = new THREE.Vector3();
  const resize = () => {
    const w = host.clientWidth || 400, h = host.clientHeight || 300;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  const el = renderer.domElement;
  el.style.cssText = "width:100%;height:100%;display:block;touch-action:none;cursor:grab";
  el.onpointerdown = (e) => { drag = true; last = e.clientX; lastY = e.clientY; el.setPointerCapture(e.pointerId); };
  let lastY = 0;
  el.onpointermove = (e) => { if (!drag) return; yaw -= (e.clientX - last) * 0.01; pitch = Math.max(-0.6, Math.min(1.0, pitch + (e.clientY - lastY) * 0.008)); last = e.clientX; lastY = e.clientY; };
  el.onpointerup = el.onpointercancel = () => { drag = false; };
  el.onwheel = (e) => { e.preventDefault(); dist = Math.max(2, Math.min(14, dist * (1 + e.deltaY * 0.001))); };
  function show(data) {
    if (cur) scene.remove(cur.root);
    const tex = new THREE.TextureLoader().load(data.tex);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.colorSpace = THREE.SRGBColorSpace;
    cur = buildModel(THREE, data, tex); cur.anim = data.anim;
    cur.root.scale.setScalar(1 / 16);
    const box = new THREE.Box3().setFromObject(cur.root), size = box.getSize(new THREE.Vector3());
    box.getCenter(center); center.y = box.min.y + size.y * 0.5;
    dist = Math.max(size.y, size.x, size.z) * 1.9 + 1;
    scene.add(cur.root); resize();
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (!run) return;
    if (!drag) yaw += 0.004;
    if (cur) applyAnim(cur, cur.anim, (now - t0) / 1000);
    camera.position.set(center.x + Math.sin(yaw) * Math.cos(pitch) * dist, center.y + Math.sin(pitch) * dist, center.z - Math.cos(yaw) * Math.cos(pitch) * dist);
    camera.lookAt(center);
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);
  addEventListener("resize", resize);
  return { show, resize, pause: (p) => { run = !p; }, destroy() { cancelAnimationFrame(raf); removeEventListener("resize", resize); renderer.dispose(); el.remove(); } };
}
