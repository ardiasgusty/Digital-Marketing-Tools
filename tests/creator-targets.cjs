const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('index.html','utf8');
const storage=new Map([['gh_config',JSON.stringify({user:'test',repo:'test'})]]);
const latest={token:'encrypted-fixture',customSetting:'tetap utuh ✓',creatorTargets:{wafie:{reels:15,youtube:3},rizky:{total:40}}};
let put=null, status=200;
const context={
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},
    sessionStorage:{getItem:()=> 'superadmin'},
    document:{getElementById:()=>null},
    getGHConfig:()=>({user:'test',repo:'test',token:'test-token'}),
    getCreatorTargets:()=>JSON.parse(storage.get('honda_creator_targets')||'{}'),
    getDecryptedGeminiKey:()=>'', encryptSecret:value=>value,
    checkGHConnectionStatus:()=>{},checkGeminiConnectionStatus:()=>{},alert:()=>{},console,
    atob:value=>Buffer.from(value,'base64').toString('binary'),
    btoa:value=>Buffer.from(value,'binary').toString('base64'),
    escape,unescape,encodeURIComponent,decodeURIComponent,
    fetch:async(url,options)=>{
        if(options?.method==='PUT') {put=JSON.parse(options.body);return {ok:status===200,status};}
        return {ok:true,json:async()=>({sha:'latest-sha',content:Buffer.from(JSON.stringify(latest)).toString('base64')})};
    }
};
vm.createContext(context);
const start=html.indexOf('        async function saveCreatorTargets(');
vm.runInContext(html.slice(start,html.indexOf('        function openCreatorTargetModal(',start)),context);
const globalStart=html.indexOf('        async function syncSystemConfigToGithub(');
vm.runInContext(html.slice(globalStart,html.indexOf('        function resetForm(',globalStart)),context);
const decode=()=>JSON.parse(Buffer.from(put.content,'base64').toString('utf8'));
(async()=>{
    const targets={wafie:{reels:20,youtube:4},rizky:{total:50}};
    await context.saveCreatorTargets(targets);
    assert.equal(put.sha,'latest-sha');
    assert.deepEqual(decode(),{...latest,creatorTargets:targets});
    assert.deepEqual(JSON.parse(storage.get('honda_creator_targets')),targets);
    status=409;
    await assert.rejects(context.saveCreatorTargets({wafie:{reels:1,youtube:0},rizky:{total:1}}),/Pengaturan berubah/);
    assert.deepEqual(JSON.parse(storage.get('honda_creator_targets')),targets);
    status=200;
    await context.syncSystemConfigToGithub();
    assert.deepEqual(decode().creatorTargets,latest.creatorTargets); // Latest cloud targets survive settings save.
    assert.equal(decode().customSetting,latest.customSetting);
    for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) if(match[1].trim()) new vm.Script(match[1]);
    console.log('PASS: JSON merge, credentials/settings preservation, SHA conflict leaves cache unchanged, global settings retain cloud targets, script syntax');
})().catch(error=>{console.error(error);process.exitCode=1});
