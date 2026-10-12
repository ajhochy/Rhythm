const {forgetCanonicalMemoryById}=require('./src/services/memoryVaultWriteService.ts');
const path=require('node:path');
(async()=>{
 const [root,base,id,mode]=process.argv.slice(2);
 const index={removeNote:async sourceId=>{
  if(mode==='fail')throw new Error('Synthetic cleanup interruption after canonical unlink');
  const response=await fetch(`${base}/_synthetic_index/remove`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sourceId})});
  if(!response.ok)throw new Error('Synthetic index transport unavailable');return (await response.json()).removed;
 }};
 let result;try{result={success:await forgetCanonicalMemoryById(id,{memoryDir:path.join(root,'memory'),index})};}catch(error){result={success:false,code:error.code};}
 process.stdout.write(JSON.stringify({pid:process.pid,...result})+'\n');
})().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
