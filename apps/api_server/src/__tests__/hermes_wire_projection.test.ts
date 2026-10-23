import { describe, expect, it } from 'vitest';
import { projectHermesNotification } from '../routes/hermes_notify_routes';
import type { HermesRunNotification } from '../services/hermes_notify_service';

const event: HermesRunNotification = {version:2,eventId:'event',cursor:1,sessionId:'session',hermesSessionId:'chat',
  workflowId:'run',runId:'run',kind:'progress',text:'Rhythm session updated.',referenceId:null,state:'pending'};

describe('pure source wire projection (internal authority metadata unchanged)', () => {
  it('only omits the known alias for exact V1/V2 keys without mutating internal input', () => {
    const input={...event,kind:'question' as const,text:'Rhythm session has a question. Open the Rhythm session.',referenceId:'opaque-engine',engineRequestID:'opaque-engine'};
    const wire=projectHermesNotification(input)!;
    expect(Object.keys(wire).sort()).toEqual(Object.keys(event).sort());
    expect(wire.referenceId).toBe('opaque-engine'); expect(input.engineRequestID).toBe('opaque-engine');
    const {runId:_run,...v1}=event;
    expect(Object.keys(projectHermesNotification({...v1,version:1,engineRequestID:undefined})!).sort()).toEqual(Object.keys(v1).sort());
    expect(() => projectHermesNotification({...event,privateField:'secret'} as HermesRunNotification)).toThrow('Invalid notification envelope');
  });
  it('maps only two exact kind-qualified labels; coding remains progress and input remains unverified', () => {
    const input={...event,text:'Rhythm returned output; verification pending.'};
    expect(projectHermesNotification(input)).toEqual({...event});
    expect(input.text).toBe('Rhythm returned output; verification pending.');
    expect(projectHermesNotification({...event,kind:'completion',text:'Rhythm agent execution completed.'})).toEqual({...event,kind:'completion',text:'Rhythm session completed.'});
    expect(projectHermesNotification({...event,kind:'completion',text:input.text})).toBeNull();
    expect(projectHermesNotification({...event,text:'Rhythm agent execution completed.'})).toBeNull();
    expect(projectHermesNotification({...event,text:' PRIVATE model/question prose '})).toBeNull();
    expect(projectHermesNotification({...event,text:'Rhythm session updated. '})).toBeNull();
  });
  it('preserves every canonical plain label and question/card kind distinction byte-for-byte', () => {
    for (const [kind,text] of [['progress','Rhythm session linked.'],['progress','Rhythm session updated.'],
      ['completion','Rhythm session completed.'],['error','Rhythm session reported an error.'],
      ['question','Rhythm session has a question. Open the Rhythm session.'],['approval-request','Rhythm session needs approval. Open the Rhythm card.']] as const) {
      const input={...event,kind,text,referenceId:kind==='question'?'opaque-engine':kind==='approval-request'?'canonical-card':null};
      expect(projectHermesNotification(input)).toEqual(input);
    }
  });
  it('withholds malformed/unqualified Recipe labels, without inventing a workflow result or card', () => {
    for (const status of ['pending','running','blocked_reconciliation','awaiting_children']) {
      const input={...event,text:`Rhythm workflow ${status}: 1 settled, 2 awaiting.`};
      expect(projectHermesNotification(input)).toEqual(input);
    }
    const success={...event,kind:'completion' as const,text:'Rhythm workflow succeeded: 1 settled, 0 awaiting.'};
    expect(projectHermesNotification(success)).toEqual(success);
    for (const text of ['Rhythm workflow succeeded: 0 settled, 0 awaiting.','Rhythm workflow succeeded: 1 settled, 1 awaiting.',
      'Rhythm workflow succeeded: 1000000000 settled, 0 awaiting.']) expect(projectHermesNotification({...success,text})).toBeNull();
    expect(projectHermesNotification({...event,text:'Rhythm workflow blocked_approval: 0 settled, 1 awaiting.'})).toBeNull();
    for (const status of ['failed','budget_exhausted','workflow_disabled','cancelled']) {
      const input={...event,kind:'error' as const,text:`Rhythm workflow ${status}: 1 settled, 0 awaiting.`};
      expect(projectHermesNotification(input)).toEqual(input);
      expect(projectHermesNotification({...input,text:`Rhythm workflow ${status}: 1 settled, 1 awaiting.`})).toBeNull();
    }
  });
  it('explicitly rejects malformed card/question references and unsafe IDs, cursor/state or run mismatch', () => {
    for (const kind of ['question','approval-request'] as const) for (const referenceId of [null,'unsafe/id',''])
      expect(()=>projectHermesNotification({...event,kind,referenceId})).toThrow('Invalid notification envelope');
    for (const change of [{sessionId:'unsafe/id'},{eventId:''},{runId:'foreign'},{cursor:0},{cursor:10**15},{state:'invalid'}])
      expect(()=>projectHermesNotification({...event,...change} as HermesRunNotification)).toThrow('Invalid notification envelope');
  });
});
