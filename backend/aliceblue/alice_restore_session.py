"""Private OS-owner utility. Reuse a valid encrypted broker session, never a password.

Produces a single-use, two-minute localhost recovery URL. Never publishes a
broker token. Run only from the private backend directory on the owner's PC.
"""
import asyncio,json,os,secrets,sqlite3
from pathlib import Path
from alice_service import settings,ensure_session_key,Store,Broker,session_seconds,PREFIX

async def main():
    folder=Path(os.environ['LOCALAPPDATA'])/'IWSM';cfg=settings(folder/'aliceblue.env')
    store=Store(str(folder/'aliceblue-sessions.sqlite3'),ensure_session_key(folder,cfg))
    with sqlite3.connect(store.path) as conn:rows=conn.execute('select data from sessions order by expires desc').fetchall()
    broker=Broker()
    try:
        for (blob,) in rows:
            try:data=json.loads(store.cipher.decrypt(blob));token=data.get('token') or data.get('ownerRecoveryToken')
            except Exception:continue
            if not token or not session_seconds(token):continue
            try:await broker.post('/obrest/optionChain/getUnderlying',{'exch':'nse_fo'},token)
            except Exception:continue
            # Private OS-only vault record is not accepted as a browser session.
            # Preserve it if the short recovery link is not redeemed in time.
            if not data.get('ownerRecoveryToken'):store.put(secrets.token_urlsafe(32),{'ownerRecoveryToken':token},session_seconds(token))
            grant=secrets.token_urlsafe(32);store.put(grant,{'restoreToken':token},120)
            # Consumed by the local operator/browser only; never log in deployment.
            print(cfg['ALICEBLUE_REDIRECT_URL'].split(PREFIX)[0]+PREFIX+'/auth/restore?grant='+grant)
            return
        raise SystemExit('No reusable broker session. One broker login is required.')
    finally:await broker.http.aclose()

if __name__=='__main__':asyncio.run(main())
