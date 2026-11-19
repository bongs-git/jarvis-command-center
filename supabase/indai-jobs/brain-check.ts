/// Probe the public talk endpoint with a fixed, stateless question after a release.
export async function checkBrainStream() {
  const url = new URL("/functions/v1/indai-brain", Deno.env.get("SUPABASE_URL"));
  const key = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const start = performance.now();
  const res = await fetch(url, {
    method: "POST",
    headers: {apikey:key, Authorization:"Bearer " + key, "Content-Type":"application/json", Accept:"text/event-stream"},
    body: JSON.stringify({mode:"talk", stream:true, search:false, question:"Say good morning.", session:"release-check"}),
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok || !res.body || !res.headers.get("content-type")?.startsWith("text/event-stream")) {
    await res.body?.cancel();
    return {ok:false,detail:"Streaming probe returned HTTP " + res.status + " without an SSE response."};
  }
  const reader=res.body.getReader(), decoder=new TextDecoder();
  let buf="", spoken="", first:number|null=null, final:string|null=null, count=0, done=false, bytes=0;
  try {
    while (!done) {
      const block=await reader.read();
      if (block.done) break;
      bytes+=block.value.byteLength;
      if (bytes>65536) throw new Error("Oversized probe");
      buf+=decoder.decode(block.value,{stream:true});
      let end:number;
      while ((end=buf.indexOf("\n"))>=0) {
        const line=buf.slice(0,end).trimEnd(); buf=buf.slice(end+1);
        if (!line.startsWith("data:")) continue;
        const data=line.slice(5).trim();
        if (data==="[DONE]") {done=true;break;}
        const event=JSON.parse(data);
        if (typeof event.delta==="string" && event.delta.length && final===null) {
          first??=Math.round(performance.now()-start); spoken+=event.delta; count++;
        } else if (typeof event.result?.spoken==="string" && Array.isArray(event.remembered) && final===null) {
          final=event.result.spoken;
        } else {
          return {ok:false,detail:"Streaming probe received an unexpected event."};
        }
      }
    }
  } finally { await reader.cancel().catch(()=>{});reader.releaseLock(); }
  if (first===null || !done || !spoken || spoken!==final) return {ok:false,detail:"Streaming probe did not receive matching speech and a complete final envelope."};
  const elapsed=Math.round(performance.now()-start);
  return {ok:first<1000,detail:`First spoken delta ${first} ms. Complete stream ${elapsed} ms. ${count} deltas matched the final envelope.`};
}
