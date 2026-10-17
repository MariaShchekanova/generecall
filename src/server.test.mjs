import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {routeRequest, AppError} from './server.mjs';
import {normalizeClinvar} from './engine.mjs';

const snapshot=JSON.parse(await readFile(new URL('./demo-clinvar.json',import.meta.url),'utf8'));
const report=await readFile(new URL('./demo-report.txt',import.meta.url),'utf8');
const assets={html:'<!doctype html><title>GeneRecall test</title>',snapshot,report};
const current=normalizeClinvar(snapshot,'65533');
const request=(path,body)=>new Request(`https://generecall.test${path}`,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const api=(path,body,env={},fetcher=()=>{throw Error('Unexpected outbound call');})=>routeRequest(request(path,body),env,assets,fetcher);
const compareBody={text:report,accession:'VCV000065533',confirmed:true};
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});

test('demo returns normalized, dated public evidence and visibly fictional report',async()=>{
  const result=await api('/api/demo');
  assert.equal(result.status,200);
  assert.equal(result.headers.get('cache-control'),'no-store');
  const data=await result.json();
  assert.equal(data.mode,'snapshot');
  assert.equal(data.current.accession,current.accession);
  assert.equal(data.current.classification,'Pathogenic');
  assert.equal(data.comparison.status,'difference');
  assert.match(data.reportText,/FICTIONAL REPORT/);
  assert.ok(data.retrievedAt);
  assert.ok(data.warnings.some(value=>/fictional/i.test(value)));
  assert.match(data.letter,/not proof|does not establish|not establish/);
});

test('rules parser works offline and never attempts an AI request when disabled',async()=>{
  const result=await api('/api/parse',{text:report,useAI:false},{OPENAI_API_KEY:'test-key-not-real'});
  const data=await result.json();
  assert.equal(data.engine,'rules');
  assert.equal(data.report.gene,'LYST');
  assert.equal(data.report.accession,'65533');
  assert.equal(data.report.classification,'Uncertain significance');
  assert.ok(data.report.evidenceQuotes.every(value=>typeof value==='object'&&report.includes(value.quote)));
});

test('live compare fetches only the exact confirmed ID and returns grounded letter',async()=>{
  const calls=[];
  const result=await api('/api/compare',compareBody,{},async(url,options)=>{
    calls.push({url,options});
    return response(snapshot.raw);
  });
  const data=await result.json();
  assert.equal(calls.length,1);
  const url=new URL(calls[0].url);
  assert.equal(url.hostname,'eutils.ncbi.nlm.nih.gov');
  assert.equal(url.searchParams.get('id'),'65533');
  assert.equal(data.mode,'live');
  assert.equal(data.retrievedAt,data.current.retrievedAt);
  assert.equal(data.current.id,'65533');
  assert.equal(data.comparison.status,'difference');
  assert.match(data.letter,/VCV000065533.11/);
  assert.match(data.letter,/Draft for review; not sent/);
});

test('missing confirmation, invalid accession and accession different from report are blocked before fetch',async()=>{
  for(const body of [
    {...compareBody,confirmed:false},
    {...compareBody,confirmed:'true'},
    {...compareBody,accession:'RCV000065533'},
    {...compareBody,accession:'https://evil.test/65533'},
    {...compareBody,accession:'14206'},
  ]){
    await assert.rejects(()=>api('/api/compare',body),error=>error instanceof AppError&&error.status===400);
  }
});

test('a mismatched gene is blocked despite a valid confirmed accession',async()=>{
  const mismatch=report.replace('Gene: LYST','Gene: BRCA1');
  await assert.rejects(()=>api('/api/compare',{...compareBody,text:mismatch},{},async()=>response(snapshot.raw)),/gene in the report does not match/);
});

test('matching-ID network fallback explicitly declares the evidence snapshot',async()=>{
  const result=await api('/api/compare',compareBody,{},async()=>{throw Error('Network disconnected');});
  const data=await result.json();
  assert.equal(data.mode,'snapshot');
  assert.equal(data.current.accession,current.accession);
  assert.equal(data.retrievedAt,snapshot.retrievedAt);
  assert.ok(data.warnings.some(value=>/dated public evidence snapshot/i.test(value)));
});

test('network failures never substitute snapshot evidence for a different requested ID',async()=>{
  const otherReport=report.replace('VCV000065533','VCV000014206');
  await assert.rejects(()=>api('/api/compare',{...compareBody,text:otherReport,accession:'14206'},{},async()=>{throw Error('Network disconnected');}),error=>error instanceof AppError&&error.status===503);
});

test('API rate limits use labelled rules fallback and preserve the report extraction',async()=>{
  const calls=[];
  const result=await api('/api/parse',{text:report},{OPENAI_API_KEY:'test-key-not-real'},async(url,options)=>{
    calls.push({url,options});
    return response({error:{message:'Rate limit'}},429);
  });
  const data=await result.json();
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,'https://api.openai.com/v1/responses');
  assert.equal(JSON.parse(calls[0].options.body).store,false);
  assert.equal(data.engine,'rules');
  assert.equal(data.report.classification,'Uncertain significance');
  assert.ok(data.warnings.some(value=>/quota or rate limit/i.test(value)));
});

test('AI extraction cannot retain fabricated fields or evidence quotations',async()=>{
  const extracted={gene:'BRCA1',accession:'VCV000065533',variant:'NM_000081.4(LYST):c.1540C>T (p.Arg514Ter)',classification:'Variant of uncertain significance',reportDate:'2020-06-15',lab:'Example Genetics Laboratory (fictional)',evidenceQuotes:['Gene: LYST','This quote never appeared in the source'],warnings:[]};
  const result=await api('/api/parse',{text:report},{OPENAI_API_KEY:'test-key-not-real'},async()=>response({output:[{content:[{type:'output_text',text:JSON.stringify(extracted)}]}]}));
  const data=await result.json();
  assert.equal(data.engine,'openai');
  assert.equal(data.report.gene,'LYST');
  assert.ok(data.report.warnings.some(value=>/Confirm gene/i.test(value)));
  assert.ok(data.report.evidenceQuotes.length);
  for(const item of data.report.evidenceQuotes)assert.ok(report.includes(typeof item==='string'?item:item.quote));
  assert.doesNotMatch(JSON.stringify(data.report.evidenceQuotes),/never appeared/);
});

test('empty or oversized reports are rejected and config does not expose credentials',async()=>{
  await assert.rejects(()=>api('/api/parse',{text:''}),/Paste a report excerpt/);
  await assert.rejects(()=>api('/api/parse',{text:'x'.repeat(40001)}),/Paste a report excerpt/);
  const result=await api('/api/config',undefined,{OPENAI_API_KEY:'test-secret-not-real'});
  const data=await result.json();
  assert.equal(data.aiEnabled,true);
  assert.doesNotMatch(JSON.stringify(data),/test-secret/);
  assert.equal(data.storage,'memory-only');
});

test('JSON primitives and arrays fail with actionable validation',async()=>{
  for(const body of [null,[],true,123,'a report']){
    await assert.rejects(()=>api('/api/parse',body),error=>error instanceof AppError&&error.status===400&&/JSON object/.test(error.message));
  }
});

test('the 40,000-character input limit supports non-ASCII and JSON-escaped text',async()=>{
  for(const text of ['界'.repeat(40000),'😀'.repeat(20000),'\u0001'.repeat(40000)]){
    const result=await api('/api/parse',{text,useAI:false});
    assert.equal(result.status,200);
    assert.equal((await result.json()).engine,'rules');
  }
  for(const text of ['界'.repeat(40001),' '+ 'x'.repeat(40000),'x'+' '.repeat(40000)]){
    await assert.rejects(()=>api('/api/parse',{text,useAI:false}),error=>error instanceof AppError&&error.status===400&&/40,000 characters/.test(error.message));
  }
});

test('malformed JSON and oversized encoded request bodies remain blocked',async()=>{
  const malformed=new Request('https://generecall.test/api/parse',{method:'POST',body:'{"text":'});
  await assert.rejects(()=>routeRequest(malformed,{},assets),error=>error instanceof AppError&&error.status===400&&/valid JSON/.test(error.message));
  await assert.rejects(()=>api('/api/parse',{text:'valid report',padding:'x'.repeat(256000)}),error=>error instanceof AppError&&error.status===413);
  const declared=new Request('https://generecall.test/api/parse',{method:'POST',headers:{'content-length':'256001'},body:'{"text":"valid report"}'});
  await assert.rejects(()=>routeRequest(declared,{},assets),error=>error instanceof AppError&&error.status===413);
});

test('missing or mismatched live records never silently become cached evidence',async()=>{
  await assert.rejects(()=>api('/api/compare',compareBody,{},async()=>response({result:{uids:[]}})),error=>error instanceof AppError&&error.status===404);
  await assert.rejects(()=>api('/api/compare',compareBody,{},async()=>response({},404)),error=>error instanceof AppError&&error.status===404);
  const wrong=structuredClone(snapshot.raw);
  wrong.result['65533'].uid='14206';
  await assert.rejects(()=>api('/api/compare',compareBody,{},async()=>response(wrong)),error=>error instanceof AppError&&error.status===502);
});

test('network errors are normalized instead of exposing provider internals',async()=>{
  const otherReport=report.replace('VCV000065533','VCV000014206');
  await assert.rejects(()=>api('/api/compare',{...compareBody,text:otherReport,accession:'14206'},{},async()=>{throw Error('secret internal proxy configuration');}),error=>error instanceof AppError&&error.status===503&&!/secret|proxy/.test(error.message));
});

test('malformed AI output uses labelled fallback with existing evidence quotes',async()=>{
  for(const output of ['null','[]','{}','{"unfinished":']){
    const result=await api('/api/parse',{text:report},{OPENAI_API_KEY:'test-key-not-real'},async()=>response({output:[{content:[{type:'output_text',text:output}]}]}));
    const data=await result.json();
    assert.equal(data.engine,'rules');
    assert.ok(data.report.evidenceQuotes.length);
    assert.ok(data.warnings.some(value=>/incomplete response/.test(value)));
  }
});

test('AI cannot choose between conflicting source fields or erase all grounded quotes',async()=>{
  const ambiguous=report+'\nClassification: Benign';
  const extracted={gene:'LYST',accession:'VCV000065533',variant:'',classification:'Benign',reportDate:'2020-06-15',lab:'',evidenceQuotes:['invented quotation'],warnings:[]};
  const result=await api('/api/parse',{text:ambiguous},{OPENAI_API_KEY:'test-key-not-real'},async()=>response({output:[{content:[{type:'output_text',text:JSON.stringify(extracted)}]}]}));
  const data=await result.json();
  assert.equal(data.report.classification,null);
  assert.ok(data.report.warnings.some(value=>/Multiple classification/.test(value)));
  assert.ok(data.report.evidenceQuotes.length);
  assert.ok(data.report.evidenceQuotes.every(value=>ambiguous.includes(value.quote)));
});

test('gene casing and multiple genes on a ClinVar record do not block the matching gene',async()=>{
  const multi=structuredClone(snapshot.raw);
  multi.result['65533'].genes=[{symbol:'OTHER'},{symbol:'LYST'}];
  const result=await api('/api/compare',{...compareBody,report:{gene:'lyst'}},{},async()=>response(multi));
  const data=await result.json();
  assert.equal(data.comparison.status,'difference');
});
