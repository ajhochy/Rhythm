/** Trusted container observer. Candidate code exists only inside a bounded WASM runtime. */
export const codingQuickJsWorker = String.raw`
import {createRequire} from 'node:module';
import {readFileSync,readdirSync,lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),{getQuickJS}=require('./node_modules/quickjs-emscripten');
const hash=v=>createHash('sha256').update(v).digest('hex');
const tree=(root,prefix='')=>readdirSync(root).sort().flatMap(name=>{
 const path=root+'/'+name,rel=prefix+name,info=lstatSync(path);
 if(info.isSymbolicLink())throw Error('runtime symlink');
 return info.isDirectory()?tree(path,rel+'/'):[[rel,hash(readFileSync(path))]];
});
const runtime={node:hash(readFileSync(process.execPath)),quickjs:hash(JSON.stringify(tree('/runner/node_modules')))};
const Q=await getQuickJS();
const base=[{id:'a',status:'open'},{id:'b',status:'done'},{id:'c',status:'open'}];
const specs=[['open',base,'open'],['done',base,'done'],['omitted',base,undefined],['empty_no_match',base,'open'],
 ['order',[base[2],base[1],base[0]],'open'],['unsupported_status',base,'blocked'],['input_preservation',base,'open']];
function observe(code,spec){
 const [id,original,status]=spec,rt=Q.newRuntime();rt.setMemoryLimit(16*1024*1024);rt.setMaxStackSize(128*1024);
 const deadline=Date.now()+500;rt.setInterruptHandler(()=>Date.now()>deadline);rt.removeModuleLoader();
 const vm=rt.newContext(),handles=[];
 const hold=h=>(handles.push(h),h);
 const unwrap=r=>{if(r.error){r.error.dispose();throw Error('candidate exception')}return hold(r.value)};
 const object=hold(vm.getProp(vm.global,'Object'));
 const keys=hold(vm.getProp(object,'getOwnPropertyNames')),descriptor=hold(vm.getProp(object,'getOwnPropertyDescriptor'));
 const array=hold(vm.getProp(vm.global,'Array')),isArray=hold(vm.getProp(array,'isArray'));
 const property=(value,key)=>{
   const d=unwrap(vm.callFunction(descriptor,object,value,hold(vm.newString(key))));
   const getter=hold(vm.getProp(d,'get')),setter=hold(vm.getProp(d,'set'));
   if(vm.typeof(getter)!=='undefined'||vm.typeof(setter)!=='undefined')throw Error('accessor result refused');
   return hold(vm.getProp(d,'value'));
 };
 const read=(value,depth=0)=>{
   if(depth>4)throw Error('result depth');
   const type=vm.typeof(value);
   if(type==='string')return vm.getString(value);
   if(type==='number'){const n=vm.getNumber(value);if(!Number.isFinite(n))throw Error('nonfinite');return n;}
   if(type==='boolean')return vm.dump(value);
   if(type!=='object')throw Error('unsupported result');
   // Own primitive descriptors only: no candidate JSON.stringify/toJSON or getters.
   const names=unwrap(vm.callFunction(keys,object,value)),length=vm.getNumber(hold(vm.getProp(names,'length')));
   if(length>20)throw Error('result properties');
   const own=[];for(let i=0;i<length;i++)own.push(vm.getString(hold(vm.getProp(names,i))));
   const arr=vm.dump(unwrap(vm.callFunction(isArray,array,value)));
   if(arr){
     const count=vm.getNumber(property(value,'length'));
     if(!Number.isSafeInteger(count)||count<0||count>16||own.length!==count+1||!own.includes('length')||own.some(k=>k!=='length'&&!/^\d+$/.test(k)))throw Error('result array');
     return Array.from({length:count},(_,i)=>read(property(value,String(i)),depth+1));
   }
   if(own.length!==2||!own.includes('id')||!own.includes('status'))throw Error('result task shape');
   return {id:read(property(value,'id'),depth+1),status:read(property(value,'status'),depth+1)};
 };
 const make=input=>{
  const arr=hold(vm.newArray());input.forEach((task,i)=>{const obj=hold(vm.newObject());for(const key of ['id','status'])vm.setProp(obj,key,hold(vm.newString(task[key])));vm.setProp(arr,i,obj)});return arr;
 };
 let result=null,threw=false,before=JSON.stringify(original),after=before;
 try{
  const mod=unwrap(vm.evalCode(code,'candidate.mjs',{type:'module'})),select=hold(vm.getProp(mod,'selectTasks'));
  if(vm.typeof(select)!=='function')throw Error('selectTasks missing');
  const input=make(original);before=JSON.stringify(read(input));
  const call=(arg,filter)=>{const response=vm.callFunction(select,vm.undefined,arg,...(filter===undefined?[]:[hold(vm.newString(filter))]));
   if(response.error){response.error.dispose();threw=true;return null}return read(hold(response.value));};
  result=id==='empty_no_match'?[call(make([]),'open'),call(make([base[1]]),'open')]:call(input,status);
  if(id==='input_preservation')result=null;
  after=JSON.stringify(read(input));
 }catch{threw=true;result=null;}
 finally{for(const h of handles.reverse())h.dispose();vm.dispose();rt.dispose();}
 return {id,result,threw,before,after};
}
const code=readFileSync('/capture/candidate.mjs','utf8');
const observations=specs.map(spec=>observe(code,spec));
process.stdout.write(JSON.stringify({schemaVersion:1,observations,runtime})+'\n');
`;
