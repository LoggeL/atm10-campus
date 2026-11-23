const releases=Array.from({length:18},(_,patch)=>'1.4.'+patch);
export const hasFeederPatch=(version,minimum)=>releases.indexOf(version)>=minimum;
export const reportsComputerId=version=>hasFeederPatch(version,0);
export const supportsAlignment=version=>reportsComputerId(version)||['1.1.0','1.2.0','1.3.0'].includes(version);
