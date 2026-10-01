import {
  AdditiveBlending,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";

// The released disc: 6.5 sprite width * 1.15 group scale * 0.81 photosphere.
export const SOLAR_RADIUS = (6.5 * 1.15 * 0.81) / 2;
export const SOLAR_QUALITY = Object.freeze({
  high: Object.freeze({ detail: 3, loops: 12 }),
  balanced: Object.freeze({ detail: 2, loops: 6 }),
  low: Object.freeze({ detail: 1, loops: 0 }),
});
export function celestialTier(profile = {}) {
  return SOLAR_QUALITY[profile.tier] ? profile.tier : "high";
}
export function createCelestialClock() {
  let previous = null,
    time = 0,
    held = false;
  return {
    tick(elapsed = 0, reduced = false) {
      const now = Number.isFinite(elapsed) ? elapsed : (previous ?? 0);
      if (previous !== null && !reduced && !held) time += Math.max(0, now - previous);
      previous = now;
      held = reduced;
      return time;
    },
  };
}
export function seededRandom(seed = 23917) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const NOISE = `
float hash31(vec3 p) {
  p = fract(p * .1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash31(i),hash31(i+vec3(1,0,0)),f.x),
                 mix(hash31(i+vec3(0,1,0)),hash31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash31(i+vec3(0,0,1)),hash31(i+vec3(1,0,1)),f.x),
                 mix(hash31(i+vec3(0,1,1)),hash31(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float cells(vec3 p) {
  vec3 cell = floor(p), f = fract(p);
  float d = 2.0;
  for(int x=-1;x<=1;x++) for(int y=-1;y<=1;y++) for(int z=-1;z<=1;z++) {
    vec3 o=vec3(float(x),float(y),float(z)), c=cell+o;
    vec3 jitter=vec3(hash31(c),hash31(c+17.7),hash31(c+53.2));
    vec3 v=o+.18+.64*jitter-f;
    d=min(d,dot(v,v));
  }
  return sqrt(d);
}
`;
const SURFACE_VERTEX = `
varying vec3 vSurface;
varying vec3 vViewNormal;
varying vec3 vViewPosition;
void main() {
  vSurface = normalize(position);
  vViewNormal = normalize(normalMatrix * normal);
  vec4 p = modelViewMatrix * vec4(position,1.0);
  vViewPosition = p.xyz;
  gl_Position = projectionMatrix * p;
}
`;
const SURFACE_FRAGMENT = `
uniform float uTime;
uniform float uDetail;
varying vec3 vSurface;
varying vec3 vViewNormal;
varying vec3 vViewPosition;
${NOISE}
void main() {
  vec3 p=normalize(vSurface);
  float t=uTime*.022;
  vec3 flow=vec3(noise3(p*3.1+vec3(t,0,0)),
                 noise3(p*3.1+vec3(11,t*.7,0)),
                 noise3(p*3.1+vec3(0,23,t*.5)))-.5;
  vec3 q=p+flow*.09;
  float broad=noise3(q*8.0+vec3(0,t*.18,0));
  float footprint=length(fwidth(q))*18.0;
  float resolved=1.0-smoothstep(.8,2.4,footprint);
  float granule=.5;
  if(uDetail>1.5 && resolved>.01) {
    float cell=cells(q*18.0);
    granule=mix(.5,1.0-smoothstep(.24,.78,cell),resolved);
  }
  float fine=.5;
  if(uDetail>2.5) fine=mix(.5,noise3(q*95.0),1.0-smoothstep(.22,.8,footprint));
  float network=noise3(q*17.0+vec3(t*.1,0,0));
  float heat=.57+.24*granule+.23*broad+.06*fine;
  // Stable active regions rotate with the sphere, rather than sliding over it.
  float spot=0.0, facula=0.0;
  vec3 s1=normalize(vec3(.64,.24,.72));
  vec3 s2=normalize(vec3(-.24,-.19,.95));
  vec3 s3=normalize(vec3(.35,-.44,-.82));
  float d1=length(p-s1)/.105, d2=length(p-s2)/.064, d3=length(p-s3)/.082;
  float d=min(d1,min(d2,d3));
  float umbra=1.0-smoothstep(.27,.53,d);
  float penumbra=(1.0-smoothstep(.55,1.3,d))*(.62+.38*noise3(p*140.0));
  spot=max(umbra*.79,penumbra*.45);
  facula=exp(-pow((d-1.7)*1.8,2.0))*.12;
  float mu=clamp(dot(normalize(vViewNormal),normalize(-vViewPosition)),0.0,1.0);
  float limb=.39+.61*pow(mu,.63);
  vec3 color=mix(vec3(1.0,.25,.038),vec3(1.0,.85,.49),smoothstep(.35,1.04,heat));
  color *= (heat*1.48+facula)*limb*(1.0-spot);
  color += vec3(.16,.037,.004)*pow(network,7.0)*(1.0-spot);
  // Compress emission locally: the scene intentionally uses NoToneMapping.
  // Leave headroom for the existing bloom and parchment highlight grade.
  color *= .93*(1.0-exp(-color.r*2.1))/max(color.r,.001);
  gl_FragColor=vec4(color,1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
const CORONA_FRAGMENT = `
uniform float uTime;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p=(vUv-.5)*3.6;
  float r=length(p), a=atan(p.y,p.x);
  float edge=max(fwidth(r),.003);
  float outside=smoothstep(1.0-edge,1.0+edge,r);
  float h=max(0.0,r-1.0);
  float weave=noise3(vec3(p*8.0,uTime*.022));
  float rays=.46+.23*sin(a*7.0+.4)+.17*sin(a*13.0-1.4)+.10*sin(a*29.0+weave);
  float inner=exp(-h*26.0)*.62;
  float stream=exp(-h*(11.0-rays*5.0))*(.13+.28*pow(max(0.0,rays),3.0));
  float filaments=pow(.5+.5*sin(a*93.0+weave*3.0),9.0)*exp(-h*18.0)*.055;
  float alpha=(inner+stream+filaments)*outside*(1.0-smoothstep(1.35,1.8,r));
  gl_FragColor=vec4(mix(vec3(1.0,.39,.075),vec3(1.0,.68,.3),exp(-h*17.0)),alpha);
  #include <colorspace_fragment>
}
`;
const CORONA_VERTEX = `
varying vec2 vUv;
void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
`;
const LOOP_VERTEX = `
attribute vec3 aTangent;
attribute float aSide;
attribute float aProgress;
attribute float aPhase;
uniform vec2 uResolution;
varying float vSide;
varying float vProgress;
varying float vPhase;
void main() {
  vec4 view=modelViewMatrix*vec4(position,1.0);
  vec3 tangent=mat3(modelViewMatrix)*aTangent;
  vec2 side=normalize(vec2(-tangent.y,tangent.x)+vec2(.00001));
  gl_Position=projectionMatrix*view;
  gl_Position.xy+=side*aSide*2.2/uResolution*gl_Position.w;
  vSide=aSide; vProgress=aProgress; vPhase=aPhase;
}
`;
const LOOP_FRAGMENT = `
uniform float uTime;
varying float vSide;
varying float vProgress;
varying float vPhase;
void main() {
  float cycle=.5+.5*sin(uTime*.12+vPhase);
  float envelope=.25+.75*smoothstep(.08,.9,cycle);
  float threads=.62+.38*sin(vProgress*46.0-uTime*.8+vPhase);
  float width=exp(-vSide*vSide*3.4);
  float ends=smoothstep(0.0,.035,vProgress)*(1.0-smoothstep(.965,1.0,vProgress));
  vec3 color=mix(vec3(1.0,.74,.34),vec3(1.0,.19,.02),pow(abs(vSide),.6));
  gl_FragColor=vec4(color,width*ends*envelope*threads*.94);
  #include <colorspace_fragment>
}
`;

export function makeLoopGeometry(radius = SOLAR_RADIUS, seed = 7143) {
  const random = seededRandom(seed),
    positions = [],
    tangents = [],
    sides = [],
    progress = [],
    phases = [],
    indices = [];
  const count = SOLAR_QUALITY.high.loops,
    segments = 56;
  for (let loop = 0; loop < count; loop++) {
    const azimuth = random() * Math.PI * 2,
      latitude = (random() - 0.5) * 1.4;
    const n = new Vector3(
      Math.cos(latitude) * Math.cos(azimuth),
      Math.sin(latitude),
      Math.cos(latitude) * Math.sin(azimuth),
    );
    // Loops run along the meridian: an east-west arch at the side limbs lies
    // in the view ray's plane and projects edge-on as a flat radial "handle",
    // while a meridional one is seen side-on there, rising from the limb.
    const tangent = new Vector3(-Math.sin(azimuth), 0.15 * (random() - 0.5), Math.cos(azimuth))
      .cross(n)
      .normalize();
    const span = 0.16 + random() * 0.26,
      height = 0.1 + random() * 0.23,
      phase = random() * Math.PI * 2;
    const path = (u) =>
      n
        .clone()
        .multiplyScalar(Math.cos((u - 0.5) * span))
        .addScaledVector(tangent, Math.sin((u - 0.5) * span))
        .normalize()
        .multiplyScalar(radius * (1 + height * Math.sin(Math.PI * u)));
    for (let j = 0; j <= segments; j++) {
      const u = j / segments,
        p = path(u),
        d = path(Math.min(1, u + 0.001))
          .sub(path(Math.max(0, u - 0.001)))
          .normalize();
      for (const side of [-1, 1]) {
        positions.push(...p.toArray());
        tangents.push(...d.toArray());
        sides.push(side);
        progress.push(u);
        phases.push(phase);
      }
      if (j < segments) {
        const k = loop * (segments + 1) * 2 + j * 2;
        indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aTangent", new Float32BufferAttribute(tangents, 3));
  geometry.setAttribute("aSide", new Float32BufferAttribute(sides, 1));
  geometry.setAttribute("aProgress", new Float32BufferAttribute(progress, 1));
  geometry.setAttribute("aPhase", new Float32BufferAttribute(phases, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  geometry.userData.indicesPerLoop = segments * 6;
  return geometry;
}

export function createSolarBody({ parent, camera, position, profile = {} }) {
  const root = new Group(),
    rotating = new Group(),
    clock = createCelestialClock(),
    parentQuaternion = new Quaternion();
  root.name = "solar-body";
  root.position.copy(position);
  root.add(rotating);
  parent.add(root);
  const uTime = { value: 0 },
    uDetail = { value: 3 };
  const surfaceMaterial = new ShaderMaterial({
    name: "SolarPhotosphere",
    uniforms: { uTime, uDetail },
    vertexShader: SURFACE_VERTEX,
    fragmentShader: SURFACE_FRAGMENT,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    fog: false,
    extensions: { derivatives: true },
  });
  const surface = new Mesh(new SphereGeometry(SOLAR_RADIUS, 48, 32), surfaceMaterial);
  surface.name = "solar-photosphere";
  surface.renderOrder = 100;
  rotating.add(surface);
  const coronaMaterial = new ShaderMaterial({
    name: "SolarCorona",
    uniforms: { uTime },
    vertexShader: CORONA_VERTEX,
    fragmentShader: CORONA_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
    blending: AdditiveBlending,
    extensions: { derivatives: true },
  });
  const corona = new Mesh(
    new PlaneGeometry(SOLAR_RADIUS * 3.6, SOLAR_RADIUS * 3.6),
    coronaMaterial,
  );
  corona.name = "solar-corona";
  corona.renderOrder = 102;
  root.add(corona);
  // Prominences keep the 2.2 CSS-pixel width reviewed at DPR 1. Their offset
  // is in NDC, so the CSS viewport sets it whatever the target's pixel ratio.
  const resolution = new Vector2(1, 1);
  const loopMaterial = new ShaderMaterial({
    name: "SolarProminences",
    uniforms: { uTime, uResolution: { value: resolution } },
    vertexShader: LOOP_VERTEX,
    fragmentShader: LOOP_FRAGMENT,
    side: DoubleSide,
    forceSinglePass: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
    blending: AdditiveBlending,
  });
  const loops = new Mesh(makeLoopGeometry(), loopMaterial);
  loops.name = "solar-prominences";
  loops.renderOrder = 101;
  rotating.add(loops);
  let disposed = false,
    tier = celestialTier(profile);
  const controller = {
    lifecycleOrder: 31,
    root,
    get tier() {
      return tier;
    },
    applyQuality(next = {}) {
      if (disposed) return false;
      tier = celestialTier(next);
      uDetail.value = SOLAR_QUALITY[tier].detail;
      loops.geometry.setDrawRange(
        0,
        SOLAR_QUALITY[tier].loops * loops.geometry.userData.indicesPerLoop,
      );
      loops.visible = SOLAR_QUALITY[tier].loops > 0;
      return true;
    },
    resize({ width = 1, height = 1 } = {}) {
      if (disposed) return false;
      resolution.set(Math.max(1, width), Math.max(1, height));
      return true;
    },
    update({ elapsedSeconds = 0, reducedMotion = false } = {}) {
      if (disposed) return false;
      uTime.value = clock.tick(elapsedSeconds, reducedMotion);
      rotating.rotation.set(0.2, uTime.value * 0.011, -0.12);
      if (camera) {
        camera.getWorldQuaternion(corona.quaternion);
        root.getWorldQuaternion(parentQuaternion).invert();
        corona.quaternion.premultiply(parentQuaternion);
      }
      return true;
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      root.removeFromParent();
      for (const object of [surface, loops, corona]) {
        object.geometry.dispose();
        object.material.dispose();
      }
      root.clear();
      return true;
    },
  };
  controller.applyQuality(profile);
  return controller;
}
