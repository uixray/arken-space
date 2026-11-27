import { multiply4,transform4,type Mat4 } from "./map3d-geometry";

type Obj=Record<string,unknown>;
const object=(value:unknown):Obj=>{if(!value||typeof value!=="object"||Array.isArray(value))throw Error("GLB_OBJECT");return value as Obj;};
const array=(value:unknown):unknown[]=>{if(!Array.isArray(value))throw Error("GLB_ARRAY");return value;};
const integer=(value:unknown,min=0,max=10000000)=>{if(typeof value!=="number"||!Number.isInteger(value)||value<min||value>max)throw Error("GLB_INTEGER");return value;};
const identity:Mat4=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];

/** Restricted GLB 2 triangle geometry. No external resources or executable extensions. */
export function importMap3dGlb(bytes:ArrayBuffer):number[] {
  if(bytes.byteLength<28||bytes.byteLength>8*1024*1024)throw Error("GLB_SIZE");
  const view=new DataView(bytes);
  if(view.getUint32(0,true)!==0x46546c67||view.getUint32(4,true)!==2||view.getUint32(8,true)!==bytes.byteLength)throw Error("GLB_HEADER");
  let offset=12,doc:Obj|undefined,bin:DataView|undefined,chunks=0;
  while(offset<bytes.byteLength){if(++chunks>2||offset+8>bytes.byteLength)throw Error("GLB_CHUNKS");const length=view.getUint32(offset,true),kind=view.getUint32(offset+4,true);offset+=8;if(length%4||offset+length>bytes.byteLength)throw Error("GLB_CHUNK_BOUNDS");
    if(chunks===1&&kind===0x4e4f534a&&length<=1024*1024)doc=object(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(new Uint8Array(bytes,offset,length))));
    else if(chunks===2&&kind===0x004e4942)bin=new DataView(bytes,offset,length);else throw Error("GLB_CHUNK_TYPE");offset+=length;
  }
  if(!doc||!bin||object(doc.asset).version!=="2.0")throw Error("GLB_VERSION");
  for(const key of ["extensionsUsed","extensionsRequired","skins","animations","images","textures"])if(doc[key]&&array(doc[key]).length)throw Error("GLB_UNSUPPORTED_RESOURCE");
  const buffers=array(doc.buffers);if(buffers.length!==1||object(buffers[0]).uri!==undefined)throw Error("GLB_EXTERNAL_BUFFER");
  const binaryLength=integer(object(buffers[0]).byteLength,1,bin.byteLength);if(bin.byteLength-binaryLength>3)throw Error("GLB_BUFFER_LENGTH");
  const views=array(doc.bufferViews),accessors=array(doc.accessors),meshes=array(doc.meshes),nodes=array(doc.nodes);
  if(views.length>512||accessors.length>512||meshes.length>128||nodes.length>256)throw Error("GLB_COMPLEXITY");
  const decoded=new Map<string,number[]>();let decodedValues=0,primitiveCount=0;
  const readAccessor=(index:number,position:boolean)=>{
    const key=`${index}:${position}`,cached=decoded.get(key);if(cached)return cached;
    const a=object(accessors[index]);if(a.sparse||a.normalized||a.type!==(position?"VEC3":"SCALAR"))throw Error("GLB_ACCESSOR");
    const component=integer(a.componentType),size=component===5126||component===5125?4:component===5123?2:component===5121?1:0;
    if(!size||(position&&component!==5126)||(!position&&component===5126))throw Error("GLB_COMPONENT");
    const v=object(views[integer(a.bufferView,0,views.length-1)]);if((v.buffer??0)!==0)throw Error("GLB_BUFFER");
    const start=integer(v.byteOffset??0),length=integer(v.byteLength),count=integer(a.count,1,49152),base=integer(a.byteOffset??0),components=position?3:1;
    const stride=integer(v.byteStride??size*components,size*components,252);
    if(stride%size||base%size||start%size||start+length>binaryLength||base+(count-1)*stride+size*components>length)throw Error("GLB_ACCESSOR_BOUNDS");
    decodedValues+=count*components;if(decodedValues>262144)throw Error("GLB_DECODE_BUDGET");
    const output:number[]=[];
    for(let i=0;i<count;i++)for(let j=0;j<components;j++) {
      const p=start+base+i*stride+j*size;
      const value=component===5126?bin!.getFloat32(p,true):component===5125?bin!.getUint32(p,true):component===5123?bin!.getUint16(p,true):bin!.getUint8(p);
      if(!Number.isFinite(value)||Math.abs(value)>10000000)throw Error("GLB_VALUE");output.push(value);
    }
    decoded.set(key,output);return output;
  };
  const output:number[]=[],seen=new Set<number>();
  const vector=(value:unknown,n:number,fallback:number[])=>{if(value===undefined)return fallback;const data=array(value);if(data.length!==n||!data.every(x=>typeof x==="number"&&Number.isFinite(x)&&Math.abs(x)<=1000000))throw Error("GLB_TRANSFORM");return data as number[];};
  const walk=(id:number,parent:Mat4,depth:number)=>{
    if(depth>64||seen.has(id))throw Error("GLB_NODE_GRAPH");seen.add(id);
    const node=object(nodes[id]);if(node.extensions)throw Error("GLB_NODE_EXTENSION");let local:Mat4;
    if(node.matrix!==undefined){if(node.translation||node.rotation||node.scale)throw Error("GLB_MIXED_TRANSFORM");local=vector(node.matrix,16,identity);}
    else {
      const t=vector(node.translation,3,[0,0,0]),s=vector(node.scale,3,[1,1,1]),q=vector(node.rotation,4,[0,0,0,1]);
      const [x,y,z,w]=q as [number,number,number,number];if(Math.abs(Math.hypot(x,y,z,w)-1)>.001)throw Error("GLB_ROTATION");
      local=[(1-2*y*y-2*z*z)*s[0]!, (2*x*y+2*z*w)*s[0]!, (2*x*z-2*y*w)*s[0]!,0,
        (2*x*y-2*z*w)*s[1]!, (1-2*x*x-2*z*z)*s[1]!, (2*y*z+2*x*w)*s[1]!,0,
        (2*x*z+2*y*w)*s[2]!, (2*y*z-2*x*w)*s[2]!, (1-2*x*x-2*y*y)*s[2]!,0,t[0]!,t[1]!,t[2]!,1];
    }
    const matrix=multiply4(parent,local);
    if(node.mesh!==undefined)for(const value of array(object(meshes[integer(node.mesh,0,meshes.length-1)]).primitives)) {
      if(++primitiveCount>2048)throw Error("GLB_PRIMITIVE_BUDGET");
      const primitive=object(value);if((primitive.mode??4)!==4||primitive.targets||primitive.extensions)throw Error("GLB_TRIANGLES_ONLY");
      const attributes=object(primitive.attributes),positions=readAccessor(integer(attributes.POSITION,0,accessors.length-1),true);
      const indices=primitive.indices===undefined?Array.from({length:positions.length/3},(_,i)=>i):readAccessor(integer(primitive.indices,0,accessors.length-1),false);
      if(indices.length%3||output.length+indices.length*3>147456)throw Error("GLB_TRIANGLE_BUDGET");
      for(const i of indices){if(!Number.isInteger(i)||i<0||i>=positions.length/3)throw Error("GLB_INDEX");const p=transform4(matrix,[positions[i*3]!,positions[i*3+1]!,positions[i*3+2]!,1]);if(Math.abs(p[3]!-1)>.001||!p.every(Number.isFinite))throw Error("GLB_TRANSFORM");output.push(p[0]!,p[1]!,p[2]!);}
    }
    if(node.children)for(const child of array(node.children))walk(integer(child,0,nodes.length-1),matrix,depth+1);
  };
  const scene=object(array(doc.scenes)[integer(doc.scene??0,0,array(doc.scenes).length-1)]);
  for(const id of array(scene.nodes))walk(integer(id,0,nodes.length-1),identity,0);
  if(!output.length)throw Error("GLB_EMPTY");
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<output.length;i++) {const a=i%3;min[a]=Math.min(min[a]!,output[i]!);max[a]=Math.max(max[a]!,output[i]!);}
  const scale=Math.max(...max.map((v,i)=>v-min[i]!));if(scale<1e-8)throw Error("GLB_DEGENERATE");
  return output.map((v,i)=>{const a=i%3;return (v-min[a]!)/scale+(a===1?0:(1-(max[a]!-min[a]!)/scale)/2);});
}
