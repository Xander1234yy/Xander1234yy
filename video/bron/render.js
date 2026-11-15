const {chromium}=require('playwright');const {spawn}=require('child_process');
const [,,start,end,out]=process.argv;const FPS=30;
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1920,height:1080}});
await p.goto('file://'+__dirname+'/scene.html');await p.evaluate(()=>window.ready);
const ff=spawn('ffmpeg',['-y','-f','image2pipe','-framerate',''+FPS,'-c:v','mjpeg','-i','-','-c:v','libx264','-pix_fmt','yuv420p','-crf','18','-preset','medium',out],{stdio:['pipe','ignore','inherit']});
const c=await p.$('canvas');
for(let f=+start;f<+end;f++){await p.evaluate(t=>renderFrame(t),f/FPS);const buf=await c.screenshot({type:'jpeg',quality:95});if(!ff.stdin.write(buf))await new Promise(r=>ff.stdin.once('drain',r));}
ff.stdin.end();await new Promise(r=>ff.on('close',r));await b.close();})();
