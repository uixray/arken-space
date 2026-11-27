import { camera4, type Mat4, type Vec3 } from "./map3d-geometry";

export function createMap3dCanvas(canvas:HTMLCanvasElement,onCamera:(matrix:Mat4)=>void,onLost:()=>void) {
  const gl=canvas.getContext("webgl",{alpha:false,antialias:false,powerPreference:"low-power",depth:true});
  if(!gl)throw Error("WEBGL_UNAVAILABLE");
  const compile=(kind:number,source:string)=>{const shader=gl.createShader(kind);if(!shader)throw Error("SHADER");gl.shaderSource(shader,source);gl.compileShader(shader);if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){gl.deleteShader(shader);throw Error("SHADER");}return shader;};
  const vertex=compile(gl.VERTEX_SHADER,"attribute vec3 p;attribute vec3 c;uniform mat4 camera;varying vec3 color;void main(){color=c;gl_Position=camera*vec4(p,1.0);}");
  let fragment:WebGLShader;try{fragment=compile(gl.FRAGMENT_SHADER,"precision mediump float;varying vec3 color;void main(){gl_FragColor=vec4(color,1.0);}");}catch(e){gl.deleteShader(vertex);throw e;}
  const program=gl.createProgram(),buffer=gl.createBuffer(),actors=gl.createBuffer();
  if(!program||!buffer||!actors){gl.deleteShader(vertex);gl.deleteShader(fragment);if(program)gl.deleteProgram(program);if(buffer)gl.deleteBuffer(buffer);if(actors)gl.deleteBuffer(actors);throw Error("GPU_ALLOCATION");}
  gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){gl.deleteShader(vertex);gl.deleteShader(fragment);gl.deleteProgram(program);gl.deleteBuffer(buffer);gl.deleteBuffer(actors);throw Error("PROGRAM");}
  const p=gl.getAttribLocation(program,"p"),c=gl.getAttribLocation(program,"c"),camera=gl.getUniformLocation(program,"camera");
  let count=0,actorCount=0,stopped=false,yaw=.65,pitch=.8,distance=25,target:Vec3=[0,0,0];
  const draw=()=>{
    if(stopped||gl.isContextLost())return;
    const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.5),scale=Math.min(dpr,1920/Math.max(rect.width,1),1080/Math.max(rect.height,1));
    const w=Math.max(1,Math.floor(rect.width*scale)),h=Math.max(1,Math.floor(rect.height*scale));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    const matrix=camera4(target,yaw,pitch,distance,w/h);
    gl.viewport(0,0,w,h);gl.clearColor(.045,.045,.05,1);gl.enable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);gl.uniformMatrix4fv(camera,false,new Float32Array(matrix));
    const batch=(data:WebGLBuffer,n:number)=>{if(!n)return;gl.bindBuffer(gl.ARRAY_BUFFER,data);gl.enableVertexAttribArray(p);gl.vertexAttribPointer(p,3,gl.FLOAT,false,24,0);gl.enableVertexAttribArray(c);gl.vertexAttribPointer(c,3,gl.FLOAT,false,24,12);gl.drawArrays(gl.TRIANGLES,0,n);};
    batch(buffer,count);batch(actors,actorCount);onCamera(matrix);
  };
  const lost=(event:Event)=>{event.preventDefault();onLost();};canvas.addEventListener("webglcontextlost",lost);
  const observer=typeof ResizeObserver==="undefined"?null:new ResizeObserver(draw);observer?.observe(canvas);window.addEventListener("resize",draw);
  return {
    setMesh(vertices:Float32Array){if(stopped)return;count=vertices.length/6;gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.STATIC_DRAW);draw();},
    setActors(vertices:Float32Array){if(stopped)return;actorCount=vertices.length/6;gl.bindBuffer(gl.ARRAY_BUFFER,actors);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.DYNAMIC_DRAW);draw();},
    fit(center:Vec3,radius:number){target=center;distance=Math.max(2,radius*2.8);draw();},
    orbit(dx:number,dy:number){yaw+=dx*.008;pitch=Math.max(.12,Math.min(1.5,pitch+dy*.008));draw();},
    pan(dx:number,dy:number){const k=distance*.0015;target=[target[0]+(-Math.cos(yaw)*dx+Math.sin(yaw)*dy)*k,target[1],target[2]+(Math.sin(yaw)*dx+Math.cos(yaw)*dy)*k];draw();},
    zoom(delta:number){distance=Math.max(.5,Math.min(20000,distance*Math.exp(Math.max(-1,Math.min(1,delta*.001)))));draw();},
    stop(){if(stopped)return;stopped=true;observer?.disconnect();window.removeEventListener("resize",draw);canvas.removeEventListener("webglcontextlost",lost);gl.deleteBuffer(buffer);gl.deleteBuffer(actors);gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);gl.getExtension("WEBGL_lose_context")?.loseContext();},
  };
}
