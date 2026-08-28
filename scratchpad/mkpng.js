// minimal solid-colour PNG generator (no deps) — for probes that need a real-sized photo
const zlib=require('zlib');
function crc32(buf){let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}
  let x=0xFFFFFFFF;for(const b of buf)x=t[(x^b)&0xFF]^(x>>>8);return (x^0xFFFFFFFF)>>>0;}
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);
  const td=Buffer.concat([Buffer.from(type,'ascii'),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len,td,crc]);}
module.exports=function png(w,h,rgb){
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w,0);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=2;
  const raw=Buffer.alloc(h*(1+w*3));
  for(let y=0;y<h;y++){const o=y*(1+w*3);raw[o]=0;
    for(let x=0;x<w;x++){raw[o+1+x*3]=rgb[0];raw[o+2+x*3]=rgb[1];raw[o+3+x*3]=rgb[2];}}
  const buf=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
  return 'data:image/png;base64,'+buf.toString('base64');};
