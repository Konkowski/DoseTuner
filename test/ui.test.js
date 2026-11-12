const puppeteer=require('puppeteer-core');
(async()=>{
const b=await puppeteer.launch({executablePath:''+(process.env.CHROME||'/usr/bin/google-chrome')+'',headless:'new',args:['--no-sandbox','--disable-gpu']});let fails=0;const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)fails++};
for(const [name,w,h] of [['m',390,844],['d',1280,900]]){
const p=await b.newPage();await p.setViewport({width:w,height:h,deviceScaleFactor:1,hasTouch:w<500});
const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/fonts|ERR_|Failed to load/.test(m.text()))errs.push(m.text())});
await p.goto(''+'file://'+require('path').join(__dirname,'..','dist','index.html')+'');
await p.click('[data-act=demo]');await p.waitForSelector('.tile',{timeout:120000});
ok(true,name+' result shown');
await p.screenshot({path:require('os').tmpdir()+`/dt_${name}_result.png`,fullPage:true});
const cw=await p.evaluate(()=>document.documentElement.scrollWidth);ok(cw<=w+1,name+' no horizontal overflow '+cw);
ok(await p.evaluate(()=>document.querySelectorAll('svg.ch').length>=3),name+' charts present');
ok(await p.evaluate(()=>/Cpk/.test(document.body.innerText)),name+' Cpk visible');
ok(await p.evaluate(()=>document.querySelectorAll('svg[data-line]').length===1),name+' machine line chart');
ok(await p.evaluate(()=>/Candles per head/i.test(document.body.innerText)&&/Capable|Marginal|Not capable/.test(document.body.innerText)),name+' candles + verdict');
// head detail
await p.evaluate(()=>document.querySelector('[data-act=step][data-v=heads]').click());
await p.evaluate(()=>document.querySelector('.hcard').click());
await p.waitForSelector('svg[data-scrub]');
ok(await p.evaluate(()=>document.querySelectorAll('svg[data-candle]').length===1&&document.querySelectorAll('svg[data-line]').length===1),name+' head candle + line charts');
const lb=await p.evaluate(()=>{const e=document.querySelector('svg[data-line]');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return [r.left,r.top,r.width]});
const l1=await p.evaluate(()=>document.querySelector('[id^=rl_l]').innerText);await p.mouse.move(lb[0]+lb[2]*.3,lb[1]+40);await p.mouse.down();await p.mouse.move(lb[0]+lb[2]*.6,lb[1]+40);await p.mouse.up();
ok(l1!==await p.evaluate(()=>document.querySelector('[id^=rl_l]').innerText),name+' line scrub changes');
await p.screenshot({path:require('os').tmpdir()+`/dt_${name}_line.png`});
const cb=await p.evaluate(()=>{const e=document.querySelector('svg[data-candle]');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return [r.left,r.top,r.width]});
const c1=await p.evaluate(()=>document.querySelector('[id^=rc_c]').innerText);await p.mouse.click(cb[0]+cb[2]*.3,cb[1]+60);
ok(c1!==await p.evaluate(()=>document.querySelector('[id^=rc_c]').innerText),name+' candle tap changes');
await p.screenshot({path:require('os').tmpdir()+`/dt_${name}_candle.png`});
await p.screenshot({path:require('os').tmpdir()+`/dt_${name}_head.png`,fullPage:true});
const r1=await p.evaluate(()=>document.querySelector('[id^=ro_h]').innerText);
const bb=await p.evaluate(()=>{const r=document.querySelector('svg[data-scrub]').getBoundingClientRect();return [r.left,r.top,r.width,r.height]});
await p.evaluate(()=>window.scrollTo(0,document.querySelector('svg[data-scrub]').getBoundingClientRect().top+scrollY-100));
const bb2=await p.evaluate(()=>{const r=document.querySelector('svg[data-scrub]').getBoundingClientRect();return [r.left,r.top,r.width,r.height]});
await p.mouse.move(bb2[0]+bb2[2]*0.3,bb2[1]+50);await p.mouse.down();await p.mouse.move(bb2[0]+bb2[2]*0.5,bb2[1]+60);await p.mouse.up();
const r2=await p.evaluate(()=>document.querySelector('[id^=ro_h]').innerText);
ok(r1!==r2,name+' scrub readout changes');
ok(!(await p.evaluate(()=>/NaN|undefined/.test(document.body.innerText))),name+' no NaN/undefined in head');
ok(await p.evaluate(()=>!/\bms\b/.test(document.body.innerText)&&/closing point/i.test(document.body.innerText)),name+' head screen speaks % of setpoint, no ms');
await p.screenshot({path:require('os').tmpdir()+`/dt_${name}_scrub.png`});
// apply
await p.evaluate(()=>document.querySelector('[data-act=step][data-v=apply]').click());
ok(await p.evaluate(()=>/Closing point \(% of setpoint\) =/.test(document.body.innerText)),name+' apply shows % law');
ok(await p.evaluate(()=>!/\bms\b/.test(document.body.innerText)),name+' apply has no ms unit');
// tolerance drag
await p.evaluate(()=>document.querySelector('[data-act=step][data-v=data]').click());
await p.evaluate(()=>{const b=document.querySelector('[data-act=pick]');});
const t1=await p.evaluate(()=>window.__app.ST.tol&&window.__app.ST.tol.t1);
const tv=await p.evaluate(()=>document.querySelector('#tolsvg')?1:0);ok(tv===1,name+' tolerance chart present');
if(tv){await p.evaluate(()=>window.scrollTo(0,document.querySelector('#tolsvg').getBoundingClientRect().top+scrollY-100));
const k=await p.evaluate(()=>{const r=document.querySelector('.knob[data-k=t1][data-side="1"] .kh').getBoundingClientRect();return [r.left+r.width/2,r.top+r.height/2]});
await p.mouse.move(k[0],k[1]);await p.mouse.down();await p.mouse.move(k[0]+60,k[1],{steps:5});await p.mouse.up();
const t1b=await p.evaluate(()=>window.__app.ST.tol.t1);ok(t1b>t1,name+' T1 knob dragged '+t1+'→'+t1b);
await p.screenshot({path:require('os').tmpdir()+`/dt_${name}_tol.png`});}
if(name==='m'){ // an ms file still works
 const okms=await p.evaluate(async()=>{const C=window.__app.C;const csv=C.simulateHistory({seed:5,nCycles:200,scenario:'dynamic',swing:1.5}).toCSV({plcAligned:true});window.__app.loadText(csv,'ms.csv',false);await window.__app.runAnalysis();return window.__app.ST.unit+'|'+/ ms/.test(document.body.innerText)});
 ok(okms==='ms|true',name+' ms file is detected and shown in ms ('+okms+')');}
ok(errs.length===0,name+' no JS errors '+errs.join('|'));
await p.close();}
await b.close();process.exit(fails?1:0)})();
