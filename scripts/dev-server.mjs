import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
const args=process.argv.slice(2);
const option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const host=option('--host','127.0.0.1'),port=Number(option('--port','8080'));
const root=fileURLToPath(new URL('../',import.meta.url));
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    const pathname=decodeURIComponent(url.pathname);
    if(pathname==='/'){res.writeHead(302,{Location:'/v1/'});res.end();return;}
    if(pathname.split('/').some(p=>p.startsWith('.'))){res.writeHead(404);res.end();return;}
    let path=resolve(root,'.'+pathname);
    if(path!==root&&!path.startsWith(root.endsWith(sep)?root:root+sep)){res.writeHead(404);res.end();return;}
    if((await stat(path)).isDirectory())path=resolve(path,'index.html');
    const data=await readFile(path);
    res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream','Cache-Control':'no-store'});res.end(data);
  }catch{res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');}
});
server.on('error',error=>{console.error(error.message);process.exit(1);});
server.listen(port,host,()=>console.log(`Local: http://${host}:${port}/v1/`));
