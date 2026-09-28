import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { createServer, redact } from './server.mjs';

assert.deepEqual(redact({ shareToken: 'hidden', rows: [{ text: 'test', token: 'hidden' }] }), { rows: [{text:'test'}] });
assert.equal(redact('https://example.test/?r=abc&token=def'), 'https://example.test/?r=[REDACTED]&token=[REDACTED]');
assert.throws(() => createServer(undefined, "1' OR 1=1"));
const live = process.argv.includes('--live');
let server;
let captured = '';
const client = new Client({ name: 'monogataritch-test', version: '1.0.0' });
if (live) {
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('./server.mjs', import.meta.url))],
    env: { ...process.env }, stderr: 'pipe' }));
} else {
  server = createServer(async sql => {
    captured = sql;
    if (sql.includes('SELECT value')) return [{value: JSON.stringify({id:'test',name:'test',rows:[{text:'Q&A',token:'hidden'}, {text:'next'}]})}];
    return [{id:'test', name:'test'}];
  }, '123');
  const [a,b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  await client.connect(b);
}
try {
  const tools = (await client.listTools()).tools;
  assert.deepEqual(tools.map(t=>t.name).sort(), ['get_script','list_projects']);
  assert.ok(tools.every(t=>t.annotations.readOnlyHint));
  const list = await client.callTool({name:'list_projects',arguments:{limit:100}});
  assert.ok(!list.isError, JSON.stringify(list));
  const data = JSON.parse(list.content[0].text);
  assert.ok(data.projects.length);
  const script = await client.callTool({name:'get_script',arguments:{projectId:data.projects[0].id,limit:1}});
  assert.ok(!script.isError);
  const p = JSON.parse(script.content[0].text);
  assert.equal(p.found,true);
  assert.ok(!JSON.stringify(p).includes('hidden'));
  if (!live) {
    assert.equal(p.nextOffset,1);
    await client.callTool({name:'get_script',arguments:{projectId:"x' OR 1=1 --"}});
    assert.ok(captured.includes("proj_id='x'' OR 1=1 --'"));
    assert.ok(captured.includes("sub='123'"));
    const bad = await client.callTool({name:'list_projects',arguments:{limit:-1}});
    assert.equal(bad.isError,true);
  }
  console.log(JSON.stringify({pass:true,mode:live?'live':'unit',tools:tools.length,projects:data.projects.length,scriptRead:true}));
} finally {
  await client.close();
  if (server) await server.close();
}
