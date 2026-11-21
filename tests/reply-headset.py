import asyncio, base64, io
from playwright.async_api import async_playwright
from PIL import Image
LONG = ("Amber, and here is why. The 665 calls need QQQ about 0.9 percent higher by the close, and the expected move today is only "
 "about 0.7 percent, so you are paying for a move the options market does not quite expect. Momentum is with you: price is above "
 "VWAP and the fast cloud just turned green, but the call wall at 666 sits right on top of your strike, and dealers tend to sell "
 "into that. If you went out a week instead, theta would drop from about 31 cents a day to 9, and break-even would be 667.10 "
 "instead of 666.40. My read: the idea is fine, the timing is tight. Wait for a clean break above 666 with volume, or take the "
 "week-out contract and give it room. One more thing: the Fed speaker at two could move rates and the whole tape, so if you take it, "
 "size it so a fast drop to the put wall at 660 costs you no more than your planned risk, and be out before the speech if it has not worked.")
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width':1300,'height':820}); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8765/index.html?demo=1'); await pg.wait_for_timeout(6000)
        print('reply chars', len(LONG))
        # an analysis card on top (as after a rated idea), then the follow-up and her long answer with figure lines
        await pg.evaluate("() => { const a = window.__indai.app; a.indai.muted = true; a.analysis = { idea: { sym: 'QQQ', type: 'C', strike: 665, expiry: '2026-11-23', dte: 0 }, score: { rag: 'AMBER', score: 61, pros: [], cons: [] }, at: Date.now(), final: { rag: 'AMBER', headline: 'Timing is tight against the call wall.' } }; }")
        r = await pg.evaluate("""(t) => { const i = window.__indai.app.indai, P = window.__indai.P.indai, now = Date.now();
            for (let k = 0; k < 6; k++) i.log.push({ t: now - 60000 + k * 1000, text: 'Older message number ' + k + ' that is long enough to wrap onto more than one line of the panel, so the four line cap still matters for older ones.', kind: 'info' });
            i.log.push({ t: now - 2000, text: '“why amber? what if I go out a week?”', kind: 'you' });
            i.log.push({ t: now - 500, text: t, kind: 'info' });
            i.log.push({ t: now - 400, text: '• Break-even today 666.40, next week 667.10', kind: 'info' });
            i.log.push({ t: now - 300, text: '• Theta today −0.31, next week −0.09', kind: 'info' });
            P.draw(); return { rep: P.lastReply, hasCard: !!window.__indai.app.analysis }; }""", LONG)
        print('with card', r)
        url = await pg.evaluate("() => window.__indai.P.indai.canvas.toDataURL('image/png')")
        Image.open(io.BytesIO(base64.b64decode(url.split(',')[1]))).save('/tmp/indai-reply.png')
        # a much longer reply: it scrolls
        r2 = await pg.evaluate("""(t) => { const i = window.__indai.app.indai, P = window.__indai.P.indai, now = Date.now() + 5000;
            i.log.push({ t: now - 2000, text: '“go on”', kind: 'you' }); i.log.push({ t: now, text: t + ' ' + t + ' ' + t, kind: 'info' });
            P.draw(); const a = P.lastReply; const dn = P.buttons.find(b => b.id === 'rep-dn'); dn && dn.onClick(); P.draw(); return { first: a, after: P.lastReply }; }""", LONG)
        print('very long', r2)
        print(errs or 'no errors'); await b.close()
asyncio.run(main())
