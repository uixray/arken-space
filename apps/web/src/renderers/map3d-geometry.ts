import type { IsometricSceneGeometry, Map3dSpec } from "@arken/contracts";

export type Vec3 = [number,number,number];
export type Mat4 = number[];
export const multiply4=(a:Mat4,b:Mat4):Mat4=>Array.from({length:16},(_,i)=>{
  const row=i%4,col=Math.floor(i/4);let sum=0;for(let k=0;k<4;k++)sum+=a[k*4+row]!*b[col*4+k]!;return sum;
});
export const transform4=(m:Mat4,p:number[])=>[0,1,2,3].map(r=>m[r]!*p[0]!+m[4+r]!*p[1]!+m[8+r]!*p[2]!+m[12+r]!*p[3]!);
export function invert4(m:Mat4):Mat4 {
  const rows=Array.from({length:4},(_,r)=>Array.from({length:8},(_,c)=>c<4?m[c*4+r]!:Number(c-4===r)));
  for(let c=0;c<4;c++) {
    let pivot=c;for(let r=c+1;r<4;r++)if(Math.abs(rows[r]![c]!)>Math.abs(rows[pivot]![c]!))pivot=r;
    if(Math.abs(rows[pivot]![c]!)<1e-10)throw Error("CAMERA_MATRIX");
    [rows[c],rows[pivot]]=[rows[pivot]!,rows[c]!];const div=rows[c]![c]!;
    for(let i=0;i<8;i++)rows[c]![i]!/=div;
    for(let r=0;r<4;r++)if(r!==c){const factor=rows[r]![c]!;for(let i=0;i<8;i++)rows[r]![i]!-=factor*rows[c]![i]!;}
  }
  return Array.from({length:16},(_,i)=>rows[i%4]![4+Math.floor(i/4)]!);
}
const sub=(a:Vec3,b:Vec3):Vec3=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const cross=(a:Vec3,b:Vec3):Vec3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(a:Vec3):Vec3=>{const n=Math.hypot(...a)||1;return a.map(v=>v/n) as Vec3;};
const dot=(a:Vec3,b:Vec3)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export function camera4(target:Vec3,yaw:number,pitch:number,distance:number,aspect:number):Mat4 {
  const eye:Vec3=[target[0]+Math.sin(yaw)*Math.cos(pitch)*distance,target[1]+Math.sin(pitch)*distance,target[2]+Math.cos(yaw)*Math.cos(pitch)*distance];
  const z=unit(sub(eye,target)),x=unit(cross([0,1,0],z)),y=cross(z,x);
  const view=[x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1];
  const f=1/Math.tan(Math.PI/8),near=.05,far=100000;
  return multiply4([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0],view);
}
export function pick3dGround(matrix:Mat4,x:number,y:number,altitude:number):Vec3|null {
  const inv=invert4(matrix),a=transform4(inv,[x,y,-1,1]),b=transform4(inv,[x,y,1,1]);
  const from=a.slice(0,3).map(v=>v/a[3]!),to=b.slice(0,3).map(v=>v/b[3]!);
  const dy=to[1]!-from[1]!;if(Math.abs(dy)<1e-8)return null;
  const t=(altitude-from[1]!)/dy;if(t<0||!Number.isFinite(t))return null;
  return [from[0]!+(to[0]!-from[0]!)*t,altitude,from[2]!+(to[2]!-from[2]!)*t];
}

/** One interleaved position/color buffer; procedural meshes have no external assets. */
export function buildMap3dMesh(spec:Map3dSpec,geometry:IsometricSceneGeometry,floorId?:string):Float32Array {
  const result:number[]=[];const meters=geometry.metersPerCell;
  const triangle=(a:Vec3,b:Vec3,c:Vec3,color:Vec3)=>{
    const normal=unit(cross(sub(b,a),sub(c,a))),light=.45+.55*Math.abs(dot(normal,unit([.4,.8,.25])));
    for(const p of [a,b,c])result.push(...p,...color.map(v=>v*light));
  };
  const box=(x:number,y:number,z:number,w:number,h:number,d:number,color:Vec3)=>{
    const p:Vec3[]=[[x,y,z],[x+w,y,z],[x+w,y,z+d],[x,y,z+d],[x,y+h,z],[x+w,y+h,z],[x+w,y+h,z+d],[x,y+h,z+d]];
    for(const face of [[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]]){triangle(p[face[0]!]!,p[face[1]!]!,p[face[2]!]!,color);triangle(p[face[0]!]!,p[face[2]!]!,p[face[3]!]!,color);}
  };
  const modelById=new Map(spec.models.map(m=>[m.id,m]));
  for(const cell of spec.cells) {
    if(floorId&&cell.floorId!==floorId)continue;
    const floor=geometry.floors.find(f=>f.id===cell.floorId);if(!floor||cell.kind==="VOID")continue;
    const x=cell.x*meters,z=cell.y*meters,y=floor.elevationMeters;
    box(x+.01,y-.04,z+.01,meters-.02,.04,meters-.02,(cell.x+cell.y)%2?[.43,.4,.32]:[.49,.46,.38]);
    if(cell.kind==="WALL")box(x,y,z,meters,spec.wallHeight,meters,[.56,.55,.51]);
    if(cell.kind==="DOOR") {
      const height=Math.min(2.1,spec.wallHeight),color:Vec3=[.48,.29,.12];
      if(cell.axis==="Y") {
        if(!cell.open)box(x+.4*meters,y,z+.08*meters,.2*meters,height,.84*meters,color);
        else {box(x+.4*meters,y,z,.2*meters,height,.08*meters,color);box(x+.4*meters,y,z+.92*meters,.2*meters,height,.08*meters,color);}
      } else if(!cell.open)box(x+.08*meters,y,z+.4*meters,.84*meters,height,.2*meters,color);
      else {box(x,y,z+.4*meters,.08*meters,height,.2*meters,color);box(x+.92*meters,y,z+.4*meters,.08*meters,height,.2*meters,color);}
    }
    if(cell.kind==="PROP") {
      const model=cell.modelId?modelById.get(cell.modelId):undefined;
      if(model)for(let i=0;i<model.positions.length;i+=9) {
        const p=(offset:number):Vec3=>[x+model.positions[i+offset]!*meters,y+model.positions[i+offset+1]!*meters,z+model.positions[i+offset+2]!*meters];
        triangle(p(0),p(3),p(6),[.46,.32,.18]);
      } else box(x+.2*meters,y,z+.2*meters,.6*meters,.6*meters,.6*meters,[.46,.32,.18]);
    }
    if(result.length>6000000)throw Error("3D_GEOMETRY_BUDGET");
  }
  return new Float32Array(result);
}

export function exportMap3dGlb(vertices:Float32Array):Blob {
  const count=vertices.length/6;
  if(!Number.isInteger(count)||count<3||vertices.byteLength>24000000)throw Error("3D_EXPORT_LIMIT");
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<vertices.length;i+=6)for(let axis=0;axis<3;axis++){min[axis]=Math.min(min[axis]!,vertices[i+axis]!);max[axis]=Math.max(max[axis]!,vertices[i+axis]!);}
  const doc={asset:{version:"2.0",generator:"Arken Space local procedural map"},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,COLOR_0:1},mode:4}]}],buffers:[{byteLength:vertices.byteLength}],bufferViews:[{buffer:0,byteOffset:0,byteLength:vertices.byteLength,byteStride:24}],accessors:[{bufferView:0,byteOffset:0,componentType:5126,count,type:"VEC3",min,max},{bufferView:0,byteOffset:12,componentType:5126,count,type:"VEC3"}]};
  const json=new TextEncoder().encode(JSON.stringify(doc)),jsonLength=Math.ceil(json.length/4)*4;
  const bytes=new ArrayBuffer(12+8+jsonLength+8+vertices.byteLength),view=new DataView(bytes),out=new Uint8Array(bytes);
  view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,bytes.byteLength,true);
  view.setUint32(12,jsonLength,true);view.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+jsonLength);out.set(json,20);
  const offset=20+jsonLength;view.setUint32(offset,vertices.byteLength,true);view.setUint32(offset+4,0x004e4942,true);out.set(new Uint8Array(vertices.buffer,vertices.byteOffset,vertices.byteLength),offset+8);
  return new Blob([bytes],{type:"model/gltf-binary"});
}
