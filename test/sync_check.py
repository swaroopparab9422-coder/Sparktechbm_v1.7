"""Two simulated devices sync everything (challans, employees, attendance, GST invoices) through the real sync engine."""
import asyncio, http.server, threading, functools, os, sys, json
from playwright.async_api import async_playwright
HERE=os.path.dirname(os.path.abspath(__file__)); ROOT=os.path.join(HERE,'..','app')
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*a): pass
srv=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Q,directory=ROOT)); port=srv.server_address[1]
threading.Thread(target=srv.serve_forever,daemon=True).start()
INIT="""
window.MBM_DESKTOP={platform:'windows',setReminders:async()=>true,autoBackup:async()=>true,onReminderOpen:()=>{}};
window.NativeFileBridge={saveFile:async()=>({canceled:true}),saveBase64:async()=>({canceled:true})};window.NativeNotify={status:async()=>'granted',test:async()=>true};
window.__online=false; window.__tag=''; window.__snap='';
localStorage.setItem('mbm:sync', JSON.stringify({enabled:true, code:'TEST-CODE', peer:''}));
window.__MBM_LANSYNC_OVERRIDE={
  start: async (o)=>{window.__tag=o.tag; return {port:o.port, ips:['10.0.0.5']}},
  setState: async (o)=>{ if(o.tag) window.__tag=o.tag; if(typeof o.snapshot==='string') window.__snap=o.snapshot; return true; },
  stop: async()=>true, getIps: async()=>({ips:['10.0.0.5']}),
  request: async (o)=>{ if(!window.__online) throw new Error('offline'); return await window.__net(o.cmd, o.body||''); },
  scan: async ()=>({hosts: window.__online ? ['peer'] : []}),
  addListener: (n,cb)=>{ window.__onPush=cb; } };
window.__handle=async(cmd,body)=>{ if(!window.__online) throw new Error('offline'); if(cmd==='HELLO') return {status:200,body:window.__tag}; if(cmd==='GET') return {status:200,body:window.__snap};
  if(cmd==='PUSH'){ if(window.__onPush) window.__onPush({body:body,from:'peer'}); return {status:200,body:'ok'}; } return {status:200,body:''}; };
"""
fails=[]
def check(n,c,extra=''):
    print(('  ok   ' if c else '  FAIL ')+n+('' if c else '  -> '+str(extra)));
    if not c: fails.append(n)
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pages={}
        for name in 'AB':
            ctx=await b.new_context(viewport={'width':1300,'height':900}); await ctx.add_init_script(INIT)
            pg=await ctx.new_page(); pages[name]=pg
        A,B=pages['A'],pages['B']
        async def netA(cmd,body): return await B.evaluate("([c,b])=>window.__handle(c,b)",[cmd,body])
        async def netB(cmd,body): return await A.evaluate("([c,b])=>window.__handle(c,b)",[cmd,body])
        await A.expose_function('__net',netA); await B.expose_function('__net',netB)
        for pg in (A,B):
            await pg.goto(f'http://127.0.0.1:{port}/index.html'); await pg.wait_for_function('window.MBM_GST && window.MBM_SYNC_EXT && window.MBM_SYNC && document.querySelector(".topbar")'); await pg.wait_for_timeout(300)
        async def sync_both():
            for pg in (A,B): await pg.evaluate("window.__online=true")
            await A.evaluate("window.MBM_SYNC.syncNow(true)"); await A.wait_for_timeout(2500); await B.evaluate("window.MBM_SYNC.syncNow(true)"); await B.wait_for_timeout(2500)
            for pg in (A,B): await pg.evaluate("window.__online=false")
        async def office(pg): return await pg.evaluate("window.MBM_OFFICE.collect()")
        async def new_challan(pg, cust):
            await pg.evaluate("window.MBM_APP.ACTIONS.chlNew()"); await pg.wait_for_timeout(250)
            await pg.fill('#o-customer',cust); await pg.fill('#o-address','Address of '+cust); await pg.fill('#o-ip-0','Item for '+cust); await pg.fill('#o-iq-0','1 Nos')
            await pg.click('[data-act="chlSave"]'); await pg.wait_for_timeout(400)
        async def new_emp(pg, name):
            await pg.evaluate("window.MBM_APP.ACTIONS.empNew()"); await pg.wait_for_timeout(250)
            await pg.fill('#o-en',name); await pg.fill('#o-es','26000'); await pg.evaluate("document.getElementById('o-ej').value='2025-08-08'"); await pg.click('[data-act="empSave"]'); await pg.wait_for_timeout(300)
        async def gst_save(pg, no, party='Kirloskar Oil Engines Ltd.'):
            await pg.evaluate("window.MBM_APP.go('gst',{kind:'sale',ym:'2026-09'})"); await pg.wait_for_timeout(300)
            await pg.fill('#g-date','10/09/2026'); await pg.fill('#g-no',no); await pg.fill('#g-party',party); await pg.fill('#g-gstin','27AADCK5714H1ZK'); await pg.fill('#g-taxable','10000'); await pg.click('[data-act="gstSave"]'); await pg.wait_for_timeout(300)
        async def mark(pg, emp_id, date, status):   # via the real attendance code path (sheet click)
            await pg.evaluate("([id,year])=>window.MBM_APP.go('attSheet',{id:id,year:year})",[emp_id,2026]); await pg.wait_for_timeout(250)
            await pg.evaluate("document.getElementById('toasts').innerHTML=''")
            order=['','P','H','A']; times=order.index(status)
            for _ in range(times): await pg.click(f'td[data-date="{date}"]')

        print('Everything entered on device A reaches device B')
        await new_challan(A,'Kirloskar Oil'); await new_emp(A,'Ashish Jarag'); await gst_save(A,'STA-26-27/50')
        emp=(await office(A))['employees'][0]['id']
        await mark(A,emp,'2026-09-03','P'); await mark(A,emp,'2026-09-05','P')
        await A.evaluate("window.MBM_OFFICE")  # no-op
        await sync_both()
        ob=await office(B); gb=await B.evaluate("window.MBM_GST.recs().length")
        check('challan arrived', len(ob['challans'])==1 and ob['challans'][0]['customer']=='Kirloskar Oil', ob['challans'])
        check('employee arrived', len(ob['employees'])==1 and ob['employees'][0]['name']=='Ashish Jarag')
        check('attendance arrived (2 days)', len([k for k,v in ob['attendance'].items() if v['days'].get('3')=='P' and v['days'].get('5')=='P'])==1, ob['attendance'])
        check('GST invoice arrived', gb==1, gb)

        print('Same day, different days, and number clashes while both are offline')
        await mark(A,emp,'2026-09-04','A')                 # A marks day 4
        await B.wait_for_timeout(50); await mark(B,emp,'2026-09-08','H')   # B marks day 8
        await mark(A,emp,'2026-09-09','P'); await A.wait_for_timeout(30); await mark(B,emp,'2026-09-09','P'); await mark(B,emp,'2026-09-09','P')  # day 9: A=P (older), B=H (newer)
        await new_challan(A,'Sound Castings'); await new_challan(B,'Bharat Auto')       # both get the next number offline
        na=[c['no'] for c in (await office(A))['challans']]; nb=[c['no'] for c in (await office(B))['challans']]
        check('both devices picked the same next number offline (a real clash)', len(set(na)&set(nb))>=2, (na,nb))
        await sync_both(); await sync_both()
        oa,ob=await office(A),await office(B)
        att_a=list(oa['attendance'].values())[0]['days']; att_b=list(ob['attendance'].values())[0]['days']
        check('days marked on different devices are both kept', att_a.get('4')=='A' and att_a.get('8')=='H' and att_b.get('4')=='A' and att_b.get('8')=='H', (att_a,att_b))
        check('same day edited on both: the newest edit wins on both devices', att_a.get('9')=='H' and att_b.get('9')=='H', (att_a.get('9'),att_b.get('9')))
        nums_a=sorted(c['no'] for c in oa['challans']); nums_b=sorted(c['no'] for c in ob['challans'])
        check('three challans on both devices with three different numbers', nums_a==nums_b and len(set(nums_a))==3, (nums_a,nums_b))

        print('Deleting on one device deletes on the other')
        old=[c for c in ob['challans'] if c['customer']=='Kirloskar Oil'][0]['id']
        await B.evaluate("window.MBM_APP.go('challanList',{})"); await B.wait_for_timeout(300)
        await B.click(f'[data-act="chlDelete"][data-id="{old}"]'); await B.wait_for_timeout(300); await B.click('#modal-root [data-i="1"]'); await B.wait_for_timeout(300)
        await gst_save(B,'STA-26-27/51'); gid=(await B.evaluate("window.MBM_GST.recs().filter(r=>r.no==='STA-26-27/50')[0].id"))
        await B.evaluate("window.MBM_APP.go('gst',{kind:'sale',ym:'2026-09'})"); await B.wait_for_timeout(300)
        await B.click(f'[data-act="gstDelete"][data-id="{gid}"]'); await B.wait_for_timeout(300); await B.click('#modal-root [data-i="1"]'); await B.wait_for_timeout(300)
        await sync_both(); await sync_both()
        ca=[c['customer'] for c in (await office(A))['challans']]; ga=await A.evaluate("window.MBM_GST.recs().map(r=>r.no).sort()")
        check('deleted challan is gone on device A and did not come back', 'Kirloskar Oil' not in ca and len(ca)==2, ca)
        check('deleted GST invoice is gone on device A, the new one arrived', ga==['STA-26-27/51'], ga)

        print('Invoices (Generate Invoice) sync too')
        await A.evaluate("window.MBM_APP.ACTIONS.invNew()"); await A.wait_for_timeout(300)
        await A.fill('#i-rname','Indo Spark Construction Services'); await A.fill('#i-d-0','Metal Cap Sensors'); await A.fill('#i-q-0','3'); await A.fill('#i-r-0','3500'); await A.click('[data-act="invSave"]'); await A.wait_for_timeout(400)
        await sync_both()
        ib=await B.evaluate("window.MBM_INVOICE.list().map(r=>r.no)"); check('invoice arrived on device B with its number', len(ib)==1 and ib[0].startswith('STA 26-27/'), ib)
        iid=await B.evaluate("window.MBM_INVOICE.list()[0].id")
        await B.evaluate("window.MBM_APP.go('invoiceList',{})"); await B.wait_for_timeout(300); await B.click(f'[data-act="invDelete"][data-id="{iid}"]'); await B.wait_for_timeout(300); await B.click('#modal-root [data-i="1"]'); await B.wait_for_timeout(300)
        await sync_both(); await sync_both()
        check('deleting the invoice on B deletes it on A', (await A.evaluate("window.MBM_INVOICE.list().length"))==0)

        print('Settings and employee removal')
        await A.evaluate("window.MBM_APP.go('attPayroll',{ym:'2026-09'})"); await A.wait_for_timeout(300); await A.fill('#o-workdays','25'); await A.dispatch_event('#o-workdays','change'); await A.wait_for_timeout(200)
        await sync_both()
        check('salary setting (25 working days) reached device B', (await office(B))['settings']['workDays']==25)
        await B.evaluate("window.MBM_APP.go('empList',{})"); await B.wait_for_timeout(250); await B.click('[data-act="empEdit"]'); await B.wait_for_timeout(250); await B.click('[data-act="empDelete"]'); await B.wait_for_timeout(300); await B.click('#modal-root [data-i="1"]'); await B.wait_for_timeout(300)
        await sync_both(); await sync_both()
        oa=await office(A); check('removing an employee on B removes the employee and attendance on A', len(oa['employees'])==0 and len(oa['attendance'])==0, (len(oa['employees']),len(oa['attendance'])))

        print('A phone (which has no challan/attendance/GST data) does not wipe anything')
        res=await B.evaluate("window.MBM_SYNC_EXT.apply(undefined)"); check('a snapshot without the extra data changes nothing', res['changed']==0)
        await b.close()
asyncio.run(main())
print('FAILED:',fails or 'none'); sys.exit(1 if fails else 0)
