import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {routeRequest,AppError} from '../src/server.mjs';
const root=new URL('../',import.meta.url);
try{process.loadEnvFile(new URL('.env.local',root));}catch(error){
  if(error.code!=='ENOENT'){console.error('Unable to read .env.local. Check the file permissions and format.');process.exit(1);}
}
const port=Number(process.env.PORT||4317);
if(!Number.isInteger(port)||port<1||port>65535){console.error('PORT must be a whole number between 1 and 65535.');process.exit(1);}
const server=http.createServer(async(req,res)=>{
  try{
    const origin=`http://127.0.0.1:${port}`;
    if(req.method==='POST'&&req.headers.origin&&![origin,`http://localhost:${port}`].includes(req.headers.origin)){res.writeHead(403);res.end('Cross-origin request refused');return;}
    const chunks=[];let length=0;
    for await(const chunk of req){length+=chunk.length;if(length>256000){res.writeHead(413,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:'Use a report excerpt under 40,000 characters.'}));return;}chunks.push(chunk);}
    const [html,snapshot,report]=await Promise.all(['src/index.html','src/demo-clinvar.json','src/demo-report.txt'].map(p=>readFile(new URL(p,root),'utf8')));
    const request=new Request(new URL(req.url,origin),{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})});
    const response=await routeRequest(request,process.env,{html,snapshot:JSON.parse(snapshot),report});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch(e){res.writeHead(e.status||500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:e instanceof AppError?e.message:'Unable to complete request.'}));}
});
server.on('error',error=>{
  console.error(error.code==='EADDRINUSE'
    ? `Port ${port} is already in use. If GeneRecall is running, open http://127.0.0.1:${port}. Otherwise choose a different PORT in .env.local.`
    : 'GeneRecall could not start. Check local network permissions and your PORT setting.');
  process.exit(1);
});
server.listen(port,'127.0.0.1',()=>console.log(`GeneRecall ready: http://127.0.0.1:${port}\nAI extraction: ${process.env.OPENAI_API_KEY?'configured':'not configured'}`));
