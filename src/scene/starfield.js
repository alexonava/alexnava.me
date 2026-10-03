import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
  Vector3,
} from "three";
import { celestialTier, createCelestialClock, seededRandom } from "./solar-body.js";
import { CELESTIAL_FIELD_GLSL, celestialClusterDirection } from "./celestial-field.js";
import { CLOUD_TEXT_GLSL, cloudFieldGLSL } from "./estate-sky.js";
export const STAR_COUNTS = Object.freeze({ high: 4200, balanced: 2600, low: 1200 });
// The smallest star sprite in device pixels (the faint stars are 1.25-1.9 CSS px).
export const STAR_MIN_FOOTPRINT = 2;
export function makeStarGeometry(seed = 92717) {
  const random = seededRandom(seed),
    clusterRandom = seededRandom(seed ^ 0x9e3779b9),
    positions = [],
    celestialPositions = [],
    colors = [],
    sizes = [],
    phases = [];
  for (let i = 0; i < STAR_COUNTS.high; i++) {
    const y = -0.08 + random() * 1.08,
      azimuth = random() * Math.PI * 2,
      r = Math.sqrt(1 - y * y);
    positions.push(r * Math.cos(azimuth) * 180, y * 180, r * Math.sin(azimuth) * 180);
    if (i >= STAR_COUNTS.low && i % 47 === 0) {
      const radius = Math.sqrt(clusterRandom()) * 0.115,
        angle = clusterRandom() * Math.PI * 2;
      celestialPositions.push(
        ...celestialClusterDirection(
          0.17 + Math.cos(angle) * radius,
          -0.04 + Math.sin(angle) * radius * 0.6,
        )
          .multiplyScalar(180)
          .toArray(),
      );
    } else celestialPositions.push(...positions.slice(-3));
    const magnitude = Math.pow(random(), 6),
      temperature = random();
    const color =
      temperature < 0.16 ? [1, 0.78, 0.59] : temperature > 0.78 ? [0.72, 0.84, 1] : [1, 0.96, 0.89];
    const intensity = 0.13 + magnitude * 0.65;
    colors.push(...color.map((c) => c * intensity));
    sizes.push(1.25 + magnitude * 2.0);
    phases.push(random() * Math.PI * 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("aCelestialPosition", new Float32BufferAttribute(celestialPositions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setAttribute("aSize", new Float32BufferAttribute(sizes, 1));
  geometry.setAttribute("aPhase", new Float32BufferAttribute(phases, 1));
  geometry.computeBoundingSphere();
  return geometry;
}
// `sky` is the sky shell material's uniforms and `skyRadius` the shell's radius
// (WORLD.SKY_DOME_RADIUS): in film each star dims behind the cloud bank its view ray
// meets on the shell, on the sky's own drift clock, so stars show only between the
// banks, and the banks' text guard reads the same name and intro box (slateText,
// slateAspect). Without them the stars draw over a clear sky.
export function createStarfield({
  parent,
  camera,
  profile = {},
  sky = {},
  skyRadius = 130,
  nebulaLayers = sky.uNebulaLayers ?? { value: 0 },
}) {
  const clock = createCelestialClock(),
    center = new Vector3();
  const material = new ShaderMaterial({
    name: "CelestialStars",
    vertexColors: true,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    fog: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      // aSize is in CSS pixels; this scales it to the device-pixel composer target.
      uPixelRatio: { value: 1 },
      uVisibility: { value: 1 },
      // Borrowed from the sky: film activation, fallback and tiers change once.
      uNebulaLayers: nebulaLayers,
      uCelestialTier: { value: 1 },
      // Also borrowed, never owned or freed: the cloud banks' clock and switches.
      uSkyTime: sky.uTime ?? { value: 0 },
      uFilm: sky.uFilm ?? { value: 0 },
      uClouds: sky.uClouds ?? { value: 0 },
      uSkyRadius: { value: skyRadius },
      uCloudReshape: sky.uCloudReshape ?? { value: 0 },
      slateText: sky.slateText ?? { value: { x: 2, y: 2, z: -1, w: -1 } },
      slateAspect: sky.slateAspect ?? { value: 1 },
    },
    vertexShader: `
      attribute float aSize;attribute float aPhase;
      attribute vec3 aCelestialPosition;
      uniform float uTime;uniform float uPixelRatio;uniform float uVisibility;
      uniform float uNebulaLayers;uniform float uCelestialTier;
      uniform float uSkyTime;uniform float uFilm;uniform float uClouds;uniform float uSkyRadius;
      uniform float uCloudReshape;uniform vec4 slateText;uniform float slateAspect;
      varying vec3 vColor;
      ${CELESTIAL_FIELD_GLSL}
      ${CLOUD_TEXT_GLSL}
      // The sky's cloud cover at a shell direction, with the text guard where the
      // star lands on screen (estate-sky.js).
      float skyCloudCover(vec3 direction,float cloudText){
        float altitude=direction.y;
        ${cloudFieldGLSL("uSkyTime")}
        return cover;
      }
      void main(){
        bool cosmic=uNebulaLayers>.5 && uCelestialTier>.5;
        vec3 starPosition=cosmic?aCelestialPosition:position;
        float altitude=starPosition.y/180.0;
        float extinction=smoothstep(.015,.36,altitude);
        if(cosmic){
          vec3 direction=normalize(mat3(modelMatrix)*starPosition);
          vec2 p=celestialPlane(direction);
          float dust=celestialDust(p,celestialEnvelope(direction,p));
          // Some stars are in front of the dust. Preserve that depth distinction.
          extinction*=exp(-dust*1.8*step(.32,fract(aPhase*3.71)));
        }
        float twinkle=1.0+.075*sin(uTime*(.65+.24*sin(aPhase))+aPhase)
                          +.035*sin(uTime*1.17+aPhase*7.0);
        vColor=color*extinction*twinkle*uVisibility;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(starPosition,1.0);
        if(uFilm>.5 && uClouds>.001){
          // Where this star's view ray leaves the sky shell (centred on the world
          // origin): the bank there covers the star as it covers the sky (.94).
          vec3 ray=normalize((modelMatrix*vec4(starPosition,1.0)).xyz-cameraPosition);
          float along=dot(cameraPosition,ray);
          float reach=-along+sqrt(max(along*along-dot(cameraPosition,cameraPosition)
                                      +uSkyRadius*uSkyRadius,0.0));
          vColor*=1.0-.94*skyCloudCover(normalize(cameraPosition+ray*reach),cloudTextAt(gl_Position));
        }
        // No star draws under STAR_MIN_FOOTPRINT device px: a smaller sprite falls
        // between pixel centres and shimmers as the camera drifts. The wider sprite
        // keeps the star's light (colour scales by the area ratio).
        float size=aSize*uPixelRatio, footprint=max(size,${STAR_MIN_FOOTPRINT.toFixed(1)});
        vColor*=size*size/(footprint*footprint);
        gl_PointSize=footprint;
      }`,
    fragmentShader: `
      varying vec3 vColor;
      void main(){
        float r=length(gl_PointCoord-.5)*2.0;
        float light=exp(-r*r*2.8)*(1.0-smoothstep(.6,1.0,r));
        gl_FragColor=vec4(vColor,light);
        #include <colorspace_fragment>
      }`,
  });
  const root = new Points(makeStarGeometry(), material);
  root.name = "celestial-starfield";
  // After the sky shell (-1), before the film mountains (-0.5), which cover it.
  root.renderOrder = -0.75;
  root.frustumCulled = false;
  parent.add(root);
  let disposed = false,
    tier = celestialTier(profile);
  const controller = {
    lifecycleOrder: 31,
    root,
    get tier() {
      return tier;
    },
    applyQuality(next = {}, { pixelRatio = material.uniforms.uPixelRatio.value } = {}) {
      if (disposed) return false;
      material.uniforms.uPixelRatio.value = pixelRatio;
      tier = celestialTier(next);
      material.uniforms.uCelestialTier.value = tier === "low" ? 0 : 1;
      root.geometry.setDrawRange(0, STAR_COUNTS[tier]);
      return true;
    },
    resize({ pixelRatio = material.uniforms.uPixelRatio.value } = {}) {
      if (disposed) return false;
      material.uniforms.uPixelRatio.value = Math.max(0.5, pixelRatio);
      return true;
    },
    update({ elapsedSeconds = 0, reducedMotion = false, visibilityScale = 1 } = {}) {
      if (disposed) return false;
      material.uniforms.uTime.value = clock.tick(elapsedSeconds, reducedMotion);
      material.uniforms.uVisibility.value = visibilityScale;
      if (camera) {
        camera.getWorldPosition(center);
        parent.worldToLocal(center);
        root.position.copy(center);
      }
      return true;
    },
    dispose() {
      if (disposed) return false;
      disposed = true;
      root.removeFromParent();
      root.geometry.dispose();
      material.dispose();
      return true;
    },
  };
  controller.applyQuality(profile);
  return controller;
}
