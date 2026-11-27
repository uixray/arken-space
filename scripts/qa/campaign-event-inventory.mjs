import ts from 'typescript';
import {readdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
/** Static inventory only: never imports/evaluates application source. */
export function inspectEventProducers(source,file='fixture.ts'){
 const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),producers=[];
 const aliases=new Set(['gameEvents']),namespaces=new Set();
 for(const statement of tree.statements){
  if(!ts.isImportDeclaration(statement)||!ts.isStringLiteral(statement.moduleSpecifier)||statement.moduleSpecifier.text!=='@arken/db')continue;
  const bindings=statement.importClause?.namedBindings;
  if(bindings&&ts.isNamedImports(bindings))for(const item of bindings.elements)if((item.propertyName??item.name).text==='gameEvents')aliases.add(item.name.text);
  if(bindings&&ts.isNamespaceImport(bindings))namespaces.add(bindings.name.text);
 }
 const isEvents=node=>!!node&&(ts.isIdentifier(node)?aliases.has(node.text):ts.isPropertyAccessExpression(node)&&ts.isIdentifier(node.expression)&&namespaces.has(node.expression.text)&&node.name.text==='gameEvents');
 const literals=(node,seen=new Set())=>{
  if(!node)return null;
  if(ts.isStringLiteralLike(node))return [node.text];
  if(ts.isParenthesizedExpression(node))return literals(node.expression,seen);
  if(ts.isConditionalExpression(node)){const a=literals(node.whenTrue,seen),b=literals(node.whenFalse,seen);return a&&b?[...new Set([...a,...b])]:null;}
  if(ts.isIdentifier(node)&&!seen.has(node)){
   const next=new Set([...seen,node]);
   for(let scope=node.parent;scope;scope=scope.parent){
    if(ts.isBlock(scope)||ts.isSourceFile(scope))for(const statement of scope.statements){
     if(!ts.isVariableStatement(statement))continue;
     for(const declaration of statement.declarationList.declarations)if(ts.isIdentifier(declaration.name)&&declaration.name.text===node.text){
      if(!(statement.declarationList.flags&ts.NodeFlags.Const)||declaration.pos>=node.pos)return null;
      return literals(declaration.initializer,next);
     }
    }
    if(ts.isFunctionLike(scope)&&scope.parameters.some(p=>ts.isIdentifier(p.name)&&p.name.text===node.text))return null;
   }
  }
  return null;
 };
 const visit=node=>{
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='values'){
   const insert=node.expression.expression;
   if(ts.isCallExpression(insert)&&ts.isPropertyAccessExpression(insert.expression)&&insert.expression.name.text==='insert'&&isEvents(insert.arguments[0])){
    const value=node.arguments[0],objects=value&&ts.isArrayLiteralExpression(value)?[...value.elements]:[value];
    for(const object of objects){const fields={};let spread=false;if(object&&ts.isObjectLiteralExpression(object))for(const property of object.properties){if(ts.isSpreadAssignment(property)){spread=true;continue;}if(ts.isPropertyAssignment(property))fields[property.name.getText(tree).replace(/^['"]|['"]$/g,'')]=property.initializer;else if(ts.isShorthandPropertyAssignment(property))fields[property.name.text]=property.name;}
     const expression=fields.type,entity=fields.entityType;producers.push({file,line:tree.getLineAndCharacterOfPosition(node.getStart(tree)).line+1,type:expression&&ts.isStringLiteralLike(expression)?expression.text:null,typeExpression:expression?.getText(tree)??null,typeCandidates:literals(expression),entityType:entity&&ts.isStringLiteralLike(entity)?entity.text:null,entityExpression:entity?.getText(tree)??null,entityCandidates:literals(entity),spread,objectLiteral:!!object&&ts.isObjectLiteralExpression(object)});
    }
   }
  }
  ts.forEachChild(node,visit);
 };visit(tree);return producers;
}
export async function inventoryEventProducers(root){
 const producers=[];
 const walk=async directory=>{for(const entry of await readdir(directory,{withFileTypes:true})){if(entry.name==='test-support'||entry.name==='node_modules')continue;const path=join(directory,entry.name);if(entry.isDirectory())await walk(path);else if(entry.name.endsWith('.ts')&&!/\.(test|spec)\.ts$/.test(entry.name))producers.push(...inspectEventProducers(await readFile(path,'utf8'),relative(root,path).replaceAll('\\','/')));}};
 await walk(root);producers.sort((a,b)=>a.file.localeCompare(b.file)||a.line-b.line);return {producerCount:producers.length,literalTypes:[...new Set(producers.flatMap(p=>p.type?[p.type]:[]))].sort(),dynamic:producers.filter(p=>!p.type||p.spread||!p.objectLiteral),producers};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const result=await inventoryEventProducers(resolve('apps/server/src'));if(process.argv[2])await writeFile(resolve(process.argv[2]),JSON.stringify(result,null,2));console.log(JSON.stringify({producerCount:result.producerCount,literalTypeCount:result.literalTypes.length,dynamicCount:result.dynamic.length}));}
