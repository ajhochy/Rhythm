const {DayflowIntegrationService}=require('./src/integrations/dayflow/service.ts');
const {LocalDayflowMemoryClient}=require('./src/integrations/dayflow/memory_client.ts');
const {MemoryLedger}=require('./src/integrations/dayflow/ledger.ts');
const {DayflowConfigStore}=require('./src/integrations/dayflow/config_store.ts');
const path=require('node:path');
(async()=>{
 const [root,base,mode]=process.argv.slice(2),client=new LocalDayflowMemoryClient(base);
 if(mode==='lost'){const actual=client.createOnly.bind(client);client.createOnly=async input=>{await actual(input);throw new Error('Synthetic lost response after canonical commit');};}
 const service=new DayflowIntegrationService({source:{read:async()=>({contractVersion:'fixture-v1',sourceInstanceId:'synthetic',records:[{id:'fresh-process-card',start:'2026-10-01T08:00:00Z',summary:'Synthetic process recovery marker'}]})},memoryClient:client,ledger:new MemoryLedger(path.join(root,'ledger.json')),configStore:new DayflowConfigStore(path.join(root,'config.json'))});
 await service.updateConfig({enabled:true,timezone:'UTC'});let result;if(mode==='forget'){try{result=await service.forget(new MemoryLedger(path.join(root,'ledger.json')).entries()[0].memoryId);}catch{result={deleteError:true};}}else{const preview=await service.preview();result=await service.commit(preview.token,preview.candidates.map(c=>c.candidateId));}process.stdout.write(JSON.stringify({pid:process.pid,result,status:service.status()})+'\n');service.dispose();
})().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
