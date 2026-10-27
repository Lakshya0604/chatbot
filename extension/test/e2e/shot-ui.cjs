const path=require('path'),fs=require('fs'),os=require('os');const {chromium}=require('playwright-core');
const BUILD=path.resolve(__dirname,'../..');const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const ctx=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'cc-ui-')),{headless:false,args:[`--disable-extensions-except=${BUILD}`,`--load-extension=${BUILD}`,'--no-sandbox']});
let sw;for(let i=0;i<40&&!sw;i++){sw=ctx.serviceWorkers()[0];if(!sw)await sleep(300);}
const id=sw.url().split('/')[2];const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>m.type()==='error'&&errs.push(m.text()));
for(const [w,h,n] of [[1100,900,'desktop'],[390,844,'mobile']]){await p.setViewportSize({width:w,height:h});await p.goto(`chrome-extension://${id}/options/options.html`);await sleep(400);await p.screenshot({path:`/downloads/ui-${n}.png`,fullPage:false});await p.screenshot({path:`/downloads/ui-${n}-full.png`,fullPage:true});}
console.log('errors:',JSON.stringify(errs));await ctx.close();})();
