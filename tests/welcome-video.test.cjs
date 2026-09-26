const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-ts.cjs');
const { cleanup } = require('../scripts/cleanup-welcome-videos.cjs');
const dbKey = '@/backend/infrastructure/supabase/admin-client';
const member = { id:'11111111-1111-1111-1111-111111111111',teamId:'22222222-2222-2222-2222-222222222222',role:'member' };

test('completed onboarding does not resolve a branch or sign a video URL', async () => {
  const q = new Proxy({}, { get: (_,key) => key === 'maybeSingle' ? async () => ({ data:{team_id:member.teamId,welcome_video_completed_at:'2026-09-26'} }) : () => q });
  const db = { from:()=>q, rpc:()=>assert.fail('No video queries for completed user'), storage:()=>assert.fail('No video traffic') };
  const service = load('backend/services/welcome-video.service.ts', { [dbKey]:{getSupabaseAdmin:()=>db} });
  assert.deepEqual(await service.getWelcomeVideo(member),{data:{required:false}});
});
test('cached video URL is issued only after the current member branch is resolved', async () => {
  const calls = [];
  const q = (table) => new Proxy({}, { get: (_,key) => key === 'maybeSingle' ? async () => ({data:table==='users' ? {team_id:member.teamId} : {signed_url:'https://storage.invalid/canonical'}}) : () => q(table) });
  let allowed = true;
  const db = { from:(table)=>{calls.push(table); return q(table);}, rpc: async name=>{
    calls.push(name); return {data:allowed ? [{ id:'row',storage_path:'team/owner/asset.mp4',file_name:'welcome.mp4',size_bytes:1000,duration_seconds:60,width:1920,height:1080 }] : []};
  }, storage:{from:()=>assert.fail('Cached URL must not be re-signed')} };
  const service = load('backend/services/welcome-video.service.ts',{[dbKey]:{getSupabaseAdmin:()=>db}});
  const result = await service.getWelcomeVideo(member);
  assert.equal(result.data.video.url,'https://storage.invalid/canonical');
  assert.equal(result.data.video.id,'asset');
  assert.deepEqual(calls,['users','app_resolve_welcome_video','welcome_video_url_cache']);
  calls.length=0; allowed=false;
  assert.equal((await service.getWelcomeVideo(member)).data.required,false);
  assert.deepEqual(calls,['users','app_resolve_welcome_video']);
});
test('metadata allows phone orientation and 200MiB, rejects oversized or long videos before Storage',async()=>{
  const service = load('backend/services/welcome-video.service.ts',{[dbKey]:{getSupabaseAdmin:()=>({from:()=>assert.fail('Invalid metadata reached Storage')})}});
  const input={fileName:'phone.mp4',sizeBytes:201*1024*1024,durationSeconds:60,width:720,height:400};
  assert.ok((await service.createWelcomeVideoUpload({...member,canPublishTasks:true},input)).validationError);
  assert.ok((await service.createWelcomeVideoUpload({...member,canPublishTasks:true},{...input,sizeBytes:1000,durationSeconds:181})).validationError);
  assert.equal(service.WELCOME_VIDEO_MAX_BYTES,200*1024*1024);
  const oldUrl=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const oldKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL='https://test.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='sb_publishable_test-only';
  const accepting=load('backend/services/welcome-video.service.ts',{[dbKey]:{getSupabaseAdmin:()=>({
    from:()=>({insert:async()=>({error:null})}),
    storage:{from:()=>({createSignedUploadUrl:async()=>({data:{token:'upload-only'},error:null})})},
  })}});
  try {
    const result=await accepting.createWelcomeVideoUpload({...member,canPublishTasks:true},{...input,sizeBytes:200*1024*1024});
    assert.equal(result.data.endpoint,'https://test.storage.supabase.co/storage/v1/upload/resumable');
    assert.equal(result.data.apiKey,'sb_publishable_test-only');
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='sb_secret_misconfigured';
    assert.ok((await accepting.createWelcomeVideoUpload({...member,canPublishTasks:true},{...input,sizeBytes:100000})).unavailable);
  } finally {
    if(oldUrl===undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL=oldUrl;
    if(oldKey===undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY=oldKey;
  }
});

test('welcome player resumes locally, shows buffering, and retries completion without replaying video', async()=>{
  const harness=require('./helpers/hook-harness.cjs')();
  const map=new Map(), previous={window:global.window,document:global.document,localStorage:global.localStorage};
  global.localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),key:i=>[...map.keys()][i],get length(){return map.size;}};
  global.window={addEventListener(){},removeEventListener(){},setTimeout:()=>1,clearTimeout(){}};
  global.document={body:{style:{}},addEventListener(){},removeEventListener(){}};
  let reads=0, completions=0;
  const video={id:'fixture',fileName:'welcome.mp4',durationSeconds:120,width:1920,height:1080,sizeBytes:1000,url:'https://storage.invalid/signed'};
  function all(node){ if(!node || typeof node!=='object')return []; return [node,...[node.props?.children].flat(Infinity).flatMap(all)]; }
  const find=(tree,predicate)=>all(tree).find(predicate);
  try {
    const progress=load('frontend/features/member/welcome-video-progress.ts');
    progress.saveWelcomeProgress(`${member.id}:fixture`,45,false);
    const component=load('frontend/features/member/WelcomeVideoGate.tsx',{
      react:harness.react,
      '@/frontend/shared/api/welcome-video-client':{
        loadWelcomeVideo:async()=>{reads++;return {required:true,video};},
        completeWelcomeVideo:async()=>{completions++;if(completions===1)throw new Error('offline');},
      },
    });
    const session=component.WelcomeVideoGate({user:member});
    harness.mount(session.type,session.props);
    let tree=await harness.settle();
    let element=find(tree,n=>n.type==='video');
    const player={currentTime:0,duration:120,ended:false,paused:true};
    element.props.ref.current=player;
    assert.equal(element.props.preload,'metadata'); assert.equal(element.props.poster,'/welcome-video-poster.svg');
    element.props.onLoadedMetadata({currentTarget:player});
    assert.equal(player.currentTime,45);
    element.props.onWaiting(); tree=harness.render();
    assert.ok(find(tree,n=>n.props?.className==='welcome-video-buffering'));
    player.currentTime=120; player.ended=true;
    find(tree,n=>n.type==='video').props.onEnded(); tree=harness.render();
    find(tree,n=>n.type==='button'&&n.props.className.includes('welcome-video-continue')).props.onClick();
    tree=await harness.settle();
    assert.ok(find(tree,n=>n.props?.role==='alert'),'Save error should stay visible');
    assert.ok(find(tree,n=>n.type==='button'&&n.props.className.includes('welcome-video-continue')),'Retry save must stay available');
    find(tree,n=>n.type==='button'&&n.props.className.includes('welcome-video-continue')).props.onClick();
    tree=await harness.settle();
    assert.equal(tree,null); assert.equal(reads,1); assert.equal(completions,2); assert.equal(map.size,0);
    harness.unmount(); assert.equal(map.size,0,'Successful completion must not recreate local progress');
  } finally { for(const [key,value] of Object.entries(previous)) { if(value===undefined)delete global[key];else global[key]=value; } }
});
test('cleanup scopes deletion to the private video bucket and retries failures without dropping jobs', async()=>{
  const path='11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/33333333-3333-3333-3333-333333333333.mp4';
  const calls=[];
  const result=await cleanup({env:{NEXT_PUBLIC_SUPABASE_URL:'https://test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'test-only'}, request:async(url,init)=>{
    calls.push({url:String(url),body:JSON.parse(init.body)});
    if(String(url).endsWith('app_claim_welcome_video_cleanup')) return Response.json([{storage_path:path,lease_token:'lease'}]);
    if(init.method==='DELETE') return new Response('',{status:503});
    return new Response(null,{status:204});
  }});
  assert.deepEqual(result,{removed:0,deferred:1});
  assert.ok(calls[1].url.endsWith('/storage/v1/object/welcome-videos'));
  assert.deepEqual(calls[1].body,{prefixes:[path]});
  assert.deepEqual(calls[2].body,{p_path:path,p_lease:'lease',p_status:503});
});
test('playback progress survives reload, rejects stale/invalid positions, and stores no signed URL',()=>{
  const map=new Map(); const old=global.localStorage;
  global.localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),key:i=>[...map.keys()][i],get length(){return map.size;}};
  try {
    const progress=load('frontend/features/member/welcome-video-progress.ts');
    progress.saveWelcomeProgress('user:asset',45,false);
    assert.equal(progress.readWelcomeProgress('user:asset',120).position,45);
    assert.equal(progress.readWelcomeProgress('user:new-asset',120),null);
    assert.equal(progress.readWelcomeProgress('user:asset',10),null);
    progress.saveWelcomeProgress('user:asset',120,true);
    assert.equal(progress.readWelcomeProgress('user:asset',120).ended,true);
    progress.clearWelcomeProgress('user:asset');
    assert.equal(map.size,0);
    for(let i=0;i<40;i++) progress.saveWelcomeProgress('user:'+i,10,false);
    assert.ok(map.size<=32);
  } finally { if(old===undefined) delete global.localStorage; else global.localStorage=old; }
});
