import { Vector3 } from "three";

// One world-oriented patch for the sky's nebula and dust. The camera may
// translate through the estate without dragging the heavens along.
const center = new Vector3(-0.9, 0.26, 0.35).normalize();
const horizontal = new Vector3(0, 1, 0).cross(center).normalize();
const vertical = center.clone().cross(horizontal).normalize();
export const NEBULA_FRAME = Object.freeze({
  center: Object.freeze(center.toArray()),
  horizontal: Object.freeze(horizontal.toArray()),
  vertical: Object.freeze(vertical.toArray()),
});

const vector = (value) => `vec3(${value.map((n) => n.toFixed(7)).join(",")})`;
export const CELESTIAL_FIELD_GLSL = `
vec2 celestialPlane(vec3 direction) {
  return vec2(dot(direction,${vector(NEBULA_FRAME.horizontal)}),
              dot(direction,${vector(NEBULA_FRAME.vertical)}));
}
float celestialEnvelope(vec3 direction, vec2 p) {
  float front=smoothstep(.30,.83,dot(direction,${vector(NEBULA_FRAME.center)}));
  float width=(p.y+.24*p.x)/.20;
  float band=exp(-width*width);
  return front*band*smoothstep(.06,.24,direction.y);
}
float celestialDust(vec2 p, float envelope) {
  float lane=p.y+.24*p.x+.022-.032*sin(p.x*9.0);
  float width=lane/.031;
  float branchWidth=(lane-.070-.023*sin(p.x*14.0))/.018;
  float ridge=exp(-width*width);
  float branch=exp(-branchWidth*branchWidth)*.35;
  return envelope*(ridge+branch)*(.64+.18*sin(p.x*17.0+1.2));
}
`;
