const srv=require('child_process').spawn('node',[require('path').join(__dirname,'..','scripts','serve.js')],{env:{...process.env,PORT:'8765'}});
setTimeout(()=>{
const puppeteer=require('puppeteer-core');(async()=>{const br=await puppeteer.launch({executablePath:process.env.CHROME||'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox']});const pg=await br.newPage();await pg.setViewport({width:390,height:844,isMobile:true});
const errs=[];pg.on('pageerror',e=>errs.push(e.message));
await pg.goto('http://localhost:8765/index.html');await pg.evaluate(()=>navigator.serviceWorker.ready);await new Promise(r=>setTimeout(r,800));
const m=await pg.evaluate(async()=>{const r=await fetch('manifest.webmanifest');return (await r.json()).name});
await pg.setOfflineMode(true);await pg.reload({waitUntil:'load'});
const ok1=await pg.$eval('h1',e=>e.textContent);await pg.click('[data-act=demo]');await pg.waitForSelector('.tile',{timeout:60000});
console.log('manifest:',m,'| offline reload h1:',ok1,'| offline demo cards:',(await pg.$$('.tile')).length,'| errors:',errs.length);await br.close();srv.kill();process.exit(0);})();

},600);process.on('exit',()=>srv.kill());
