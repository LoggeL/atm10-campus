#!/usr/bin/env node
// Offline JSON validator. No network, controller, database or Minecraft access.
import {readFileSync} from 'node:fs';
import {ninePreflight} from '../src/erebor-nine-preflight.js';
try{
 if(process.argv.length!==3)throw Error('Usage: node tools/erebor-nine-preflight.js INPUT.json');
 const input=JSON.parse(readFileSync(process.argv[2],'utf8'));
 const result=ninePreflight(input.config,input.observation,input.jobs);
 console.log(JSON.stringify(result,null,2));
}catch(error){
 console.error('Preflight blocked: '+error.message);
 process.exitCode=1;
}
