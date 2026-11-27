export const portalVertex = `
attribute vec2 aPosition;
void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }
`;

// Original procedural scene. No external models, textures or tracking requests.
export const portalFragment = `
precision highp float;
uniform vec2 uResolution;
uniform vec2 uPointer;
uniform float uTime;

mat2 turn(float a) { float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
float hash(vec3 p) { return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453); }
float noise(vec3 p) {
  vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),
                 mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                 mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float block(vec3 p, vec3 b) {
  vec3 q=abs(p)-b;
  return length(max(q,0.0))+min(max(q.x,max(q.y,q.z)),0.0)-0.035;
}
float stone(vec3 p, vec3 center, float angle, float seed) {
  float hover=exp(-3.0*length(center.xy-uPointer*vec2(2.5,1.8)));
  center.z+=0.045*sin(uTime*0.8+seed)+hover*0.12;
  p-=center;
  p.xy=turn(angle+0.014*sin(uTime+seed)+hover*0.035)*p.xy;
  p.xz=turn(0.025*sin(uTime*0.7+seed))*p.xz;
  return block(p,vec3(0.21,0.25,0.25));
}
vec2 scene(vec3 p) {
  vec2 hit=vec2(p.y+1.35,0.0);
  float arch=100.0;
  for(int i=0;i<9;i++) {
    float a=float(i)*3.14159265/8.0;
    arch=min(arch,stone(p,vec3(cos(a)*1.25,0.55+sin(a)*1.25,0.0),
                       a-1.5707963,float(i)*2.3));
  }
  for(int i=0;i<3;i++) {
    float y=-0.98+float(i)*0.50;
    arch=min(arch,stone(p,vec3(-1.25,y,0.0),0.0,20.0+float(i)));
    arch=min(arch,stone(p,vec3(1.25,y,0.0),0.0,30.0+float(i)));
  }
  if(arch<hit.x) hit=vec2(arch,1.0);
  float oval=length(vec2(p.x/1.04,(p.y-0.25)/1.52))-1.0;
  float portal=max(oval*0.75,abs(p.z+0.10)-0.025);
  if(portal<hit.x) hit=vec2(portal,2.0);
  vec3 gem=p-vec3(0.0,0.10+0.10*sin(uTime*0.9),0.83);
  gem.xz=turn(uTime*0.21)*gem.xz;
  gem.xy=turn(0.12*sin(uTime*0.65))*gem.xy;
  float crystal=(abs(gem.x)+abs(gem.y*0.68)+abs(gem.z)-0.29)*0.57;
  if(crystal<hit.x) hit=vec2(crystal,3.0);
  return hit;
}
vec3 normalAt(vec3 p) {
  vec2 e=vec2(0.002,0.0);
  return normalize(vec3(scene(p+e.xyy).x-scene(p-e.xyy).x,
                        scene(p+e.yxy).x-scene(p-e.yxy).x,
                        scene(p+e.yyx).x-scene(p-e.yyx).x));
}
void main() {
  vec2 uv=(gl_FragCoord.xy-0.5*uResolution)/uResolution.y;
  uv.x+=0.22*uResolution.x/uResolution.y;
  vec3 eye=vec3(uPointer.x*0.20,0.65+uPointer.y*0.12,6.5);
  vec3 forward=normalize(vec3(0.0,0.25,0.0)-eye);
  vec3 right=normalize(cross(forward,vec3(0,1,0)));
  vec3 up=cross(right,forward);
  vec3 ray=normalize(forward*1.8+right*uv.x+up*uv.y);
  vec3 background=vec3(0.035,0.034,0.030);
  vec3 color=background;
  float distance=0.0;
  vec2 hit=vec2(1.0,0.0);
  for(int i=0;i<64;i++) {
    hit=scene(eye+ray*distance);
    if(hit.x<0.003 || distance>14.0) break;
    distance+=max(hit.x*0.65,0.002);
  }
  if(distance<14.0 && hit.x<0.003) {
    vec3 p=eye+ray*distance;
    vec3 n=normalAt(p);
    vec3 light=normalize(vec3(-2.0,4.0,4.0)-p);
    float diffuse=max(dot(n,light),0.0);
    float rim=pow(1.0-max(dot(n,-ray),0.0),3.0);
    if(hit.y<0.5) {
      color=vec3(0.060,0.056,0.047)*(0.3+diffuse*0.5);
      color+=vec3(0.22,0.095,0.035)*exp(-dot(p.xz,p.xz)*1.2)*0.35;
    } else if(hit.y<1.5) {
      float grain=noise(p*18.0);
      color=mix(vec3(0.13,0.125,0.11),vec3(0.29,0.25,0.20),grain);
      color*=0.25+diffuse*0.85;
      float hover=exp(-2.8*length(p.xy-uPointer*vec2(2.5,1.8)));
      float vein=pow(1.0-abs(sin(p.y*25.0+noise(p*7.0)*6.0)),24.0);
      color+=vec3(0.65,0.28,0.08)*(rim*0.18+vein*(0.12+hover*0.8));
    } else if(hit.y<2.5) {
      vec2 q=vec2(p.x/1.04,(p.y-0.25)/1.52);
      float radius=length(q), angle=atan(q.y,q.x);
      float spiral=sin(angle*5.0-radius*19.0+uTime*0.9+noise(p*4.0)*3.0);
      float cloud=noise(vec3(q*5.0,uTime*0.13));
      color=mix(vec3(0.025,0.055,0.065),vec3(0.18,0.39,0.36),cloud);
      color+=vec3(0.25,0.50,0.43)*pow(max(spiral,0.0),7.0)*0.38;
      color+=vec3(0.65,0.30,0.10)*pow(radius,9.0)*0.55;
      color*=0.65+0.35*radius;
    } else {
      color=vec3(0.22,0.55,0.47)*(0.5+diffuse);
      color+=vec3(0.70,0.48,0.16)*rim;
    }
    color=mix(color,background,1.0-exp(-0.025*distance*distance));
  }
  // Tiny deterministic motes drift independently; no additive postprocess pass.
  vec2 cell=floor(uv*45.0);
  float seed=hash(vec3(cell,9.0));
  vec2 dotPosition=fract(uv*45.0+vec2(0.0,uTime*0.035*(0.3+seed)))-0.5;
  float mote=(1.0-smoothstep(0.0,0.035,length(dotPosition)))*step(0.986,seed);
  color+=vec3(0.45,0.28,0.10)*mote;
  color*=1.0-0.22*smoothstep(0.3,1.5,length(uv));
  gl_FragColor=vec4(pow(max(color,0.0),vec3(0.85)),1.0);
}
`;
