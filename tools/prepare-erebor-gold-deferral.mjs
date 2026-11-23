#!/usr/bin/env node
// Local immutable staging; deliberately no credentials, database, RCON or upload writes.
import {readFileSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareGoldDeferral} from '../src/erebor-gold-deferral.js';
const [inputPath,outputPath,...extra]=process.argv.slice(2);
if(!inputPath||!outputPath||extra.length)throw Error('Usage: node tools/prepare-erebor-gold-deferral.mjs INPUT.json OUTPUT.zip');
const input=JSON.parse(readFileSync(inputPath,'utf8'));
const {zip,manifest}=prepareGoldDeferral({...input,bytes:readFileSync(input.originalPath)});
// Exclusive creation is fail-closed: interrupted files are never silently replaced.
const fd=openSync(outputPath,'wx',0o600);
try{writeFileSync(fd,zip);fsyncSync(fd);}finally{closeSync(fd);}
const digest=b=>createHash('sha256').update(b).digest('hex');
if(digest(readFileSync(outputPath))!==digest(zip))throw Error('Artifact readback mismatch');
console.log(JSON.stringify({state:manifest.state,activationAllowed:false,site:manifest.site,slot:manifest.slot,
 output:outputPath,sha256:digest(zip),continuation:manifest.continuation.blocks,deferred:manifest.deferred.blocks}));
