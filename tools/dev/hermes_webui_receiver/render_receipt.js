// Metadata is a render correlation proof, never an instruction or credential.
// Trust: authenticated UI relay attests visibility, not that a human read it.
const _rhythmRendered = new Set();
let _rhythmReceiptPending = false;
function _scheduleRhythmRenderReceipt(){
  // ponytail: bounded render opportunities, no perpetual polling or LLM wakeup.
  for(const delay of [0,100,500,1500]) setTimeout(_rhythmRenderReceipt,delay);
}
async function _rhythmRenderReceipt(){
  if(_rhythmReceiptPending || document.visibilityState!=='visible' || S.busy) return;
  const sid=S.session?.session_id;
  if(!sid || !_isSessionCurrentPane(sid)) return;
  _rhythmReceiptPending=true;
  try{
    const data=await api('/api/rhythm-notify/render-metadata?hermesSessionId='+encodeURIComponent(sid),{retries:0});
    for(const proof of data?.events||[]){
      if(_rhythmRendered.has(proof.eventId) || S.busy || S.session?.session_id!==sid ||
          proof.hermesSessionId!==sid || document.visibilityState!=='visible') continue;
      const message=S.messages?.[proof.messageIndex];
      if(message?.role!=='assistant' || !message.content ||
          JSON.stringify(message.content)!==JSON.stringify(data.contents?.[proof.messageId])) continue;
      // Bind to the existing renderer's saved-message row, never source text alone.
      const row=document.querySelector('#messages [data-msg-idx="'+proof.messageIndex+'"]');
      if(!row || row.getAttribute('data-role')==='user') continue;
      const el=row.querySelector('.msg-content p,.message-content p,.markdown-body p,p')||row;
      const r=el.getBoundingClientRect();
      const x=r.x+r.width/2,y=r.y+r.height/2;
      if(r.width<=0 || r.height<=0 || x<0 || y<0 || x>=innerWidth || y>=innerHeight) continue;
      const hit=document.elementFromPoint(x,y);
      if(!hit || !(hit===el || el.contains(hit))) continue;
      const receipt=await api('/api/rhythm-notify/render-receipt',{
        method:'POST',body:JSON.stringify(proof),retries:0});
      if(receipt?.state==='visible') _rhythmRendered.add(proof.eventId);
    }
  }catch(_){ /* fail closed; next render/reopen is a bounded retry opportunity */ }
  finally{_rhythmReceiptPending=false;}
}
document.addEventListener('visibilitychange',_scheduleRhythmRenderReceipt);
window.addEventListener('focus',_scheduleRhythmRenderReceipt);
document.addEventListener('scroll',_scheduleRhythmRenderReceipt,{capture:true,passive:true});
