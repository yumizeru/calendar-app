"""本物のサーバーで同期・通知の登録・ウィジェット・共有カレンダーを確かめる（テスト用アカウントだけを使う）

使い方:  python tools/e2e.py
必要なもの: 環境変数 SUPABASE_ACCESS_TOKEN（ユーザー単位で保存してあればよい）
 - テスト用アカウント2つ（claude-test-a / claude-test-b @hibilog.test）にはパスワードがない。
   サーバーの管理用の鍵でログイン用リンクを作り、その場でセッションに変える
 - 管理用の鍵は毎回取りに行き、ファイルにも画面にも出さない
 - 最後にテストで作ったデータを消す（テスト用アカウントの分だけ）
"""
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

REF = 'qfhtjrubmjuvabcmpzjn'
URL = f'https://{REF}.supabase.co'
PUBLISHABLE = 'sb_publishable_zc86u4BRcsmfWfaKZGRsNw_cod3V7Xp'
A_ID = '00000000-0000-4000-8000-0000000eb0a1'
B_ID = '00000000-0000-4000-8000-0000000eb0b2'
A_MAIL = 'claude-test-a@hibilog.test'
B_MAIL = 'claude-test-b@hibilog.test'


def access_token():
    t = os.environ.get('SUPABASE_ACCESS_TOKEN')
    if not t and sys.platform == 'win32':
        t = subprocess.run(
            ['powershell', '-NoProfile', '-Command',
             "[Environment]::GetEnvironmentVariable('SUPABASE_ACCESS_TOKEN','User')"],
            capture_output=True, text=True).stdout.strip()
    if not t:
        sys.exit('SUPABASE_ACCESS_TOKEN がありません')
    return t


def call(method, url, headers=None, body=None):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={
        'Content-Type': 'application/json', 'User-Agent': 'hibilog-e2e', **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, raw.decode(errors='replace')


def service_key():
    st, keys = call('GET', f'https://api.supabase.com/v1/projects/{REF}/api-keys?reveal=true',
                    {'Authorization': f'Bearer {access_token()}'})
    if st != 200:
        sys.exit(f'管理用の鍵を取れませんでした: {st}')
    for k in keys:
        if k.get('type') == 'secret' or k.get('name') == 'service_role':
            return k['api_key']
    sys.exit('管理用の鍵が見つかりません')


def session_for(email, sk):
    st, link = call('POST', f'{URL}/auth/v1/admin/generate_link',
                    {'apikey': sk, 'Authorization': f'Bearer {sk}'}, {'type': 'magiclink', 'email': email})
    if st != 200:
        sys.exit(f'{email}: リンクを作れませんでした {st} {link}')
    h = link.get('hashed_token') or link.get('properties', {}).get('hashed_token')
    st, ses = call('POST', f'{URL}/auth/v1/verify', {'apikey': PUBLISHABLE},
                   {'type': 'magiclink', 'token_hash': h})
    if st != 200:
        sys.exit(f'{email}: ログインできませんでした {st} {ses}')
    return ses['access_token']


def as_user(tok, extra=None):
    return {'apikey': PUBLISHABLE, 'Authorization': f'Bearer {tok}', **(extra or {})}


results = []


def check(name, ok, detail=''):
    ok = bool(ok)
    results.append(ok)
    print(('OK  ' if ok else 'NG  ') + name + (f'  ({detail})' if detail and not ok else ''))


def cleanup(sk):
    adm = {'apikey': sk, 'Authorization': f'Bearer {sk}'}
    ids = f'in.({A_ID},{B_ID})'
    call('DELETE', f'{URL}/rest/v1/shared_members?user_id={ids}', adm)
    call('DELETE', f'{URL}/rest/v1/shared_calendars?owner={ids}', adm)
    for t in ('notify_queue', 'reminders', 'widget_tokens', 'user_backups', 'user_data'):
        call('DELETE', f'{URL}/rest/v1/{t}?user_id={ids}', adm)


def main():
    sk = service_key()
    cleanup(sk)  # 前回の残りがあれば消してから始める
    a = session_for(A_MAIL, sk)
    b = session_for(B_MAIL, sk)
    adm = {'apikey': sk, 'Authorization': f'Bearer {sk}'}
    try:
        # 同期（自分のデータの保存と読み出し）
        data = {'events': [{'id': 'e2e-1', 'title': 'テストの予定', 'date': '2030-01-01', 'time': '10:00'}],
                'habits': [], 'marks': {}}
        st, r = call('POST', f'{URL}/rest/v1/user_data', as_user(a, {'Prefer': 'resolution=merge-duplicates'}),
                     {'user_id': A_ID, 'data': data})
        check('自分のデータを保存できる', st in (200, 201), f'{st} {r}')
        st, rows = call('GET', f'{URL}/rest/v1/user_data?select=data', as_user(a))
        check('保存したデータを読み出せる',
              st == 200 and rows and rows[0]['data']['events'][0]['title'] == 'テストの予定', f'{st} {rows}')
        st, rows = call('GET', f'{URL}/rest/v1/user_data?select=user_id', as_user(b))
        check('ほかの人のデータは見えない', st == 200 and rows == [], f'{st} {rows}')
        st, r = call('POST', f'{URL}/rest/v1/user_data', as_user(b), {'user_id': A_ID, 'data': {}})
        check('ほかの人のデータは書き換えられない', st >= 400, f'{st}')

        # 通知の予約
        fire = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        st, r = call('POST', f'{URL}/rest/v1/rpc/replace_reminders', as_user(a),
                     {'p_items': [{'event_id': 'e2e-1', 'fire_at': fire, 'title': 'テスト', 'body': '1時間後'}]})
        check('通知の予約を登録できる', st in (200, 204), f'{st} {r}')
        st, rows = call('GET', f'{URL}/rest/v1/reminders?select=event_id', as_user(a))
        check('登録した予約が見える', st == 200 and [x['event_id'] for x in rows] == ['e2e-1'], f'{st} {rows}')
        st, rows = call('GET', f'{URL}/rest/v1/reminders?select=event_id', as_user(b))
        check('ほかの人の予約は見えない', st == 200 and rows == [], f'{st} {rows}')

        # 通知を送る処理
        st, r = call('POST', f'{URL}/functions/v1/send-reminders', as_user(a), {'test': True})
        check('通知の処理が動く（端末がないので「通知登録がありません」）', st == 404, f'{st} {r}')
        st, r = call('POST', f'{URL}/functions/v1/send-reminders', {'apikey': PUBLISHABLE}, {})
        check('ログインしていないと通知の処理は使えない', st == 401, f'{st} {r}')

        # ウィジェット
        st, r = call('POST', f'{URL}/rest/v1/widget_tokens', as_user(a, {'Prefer': 'return=representation'}),
                     {'user_id': A_ID})
        token = r[0]['token'] if st == 201 and r else None
        check('ウィジェット用の合言葉を作れる', bool(token) and len(token) >= 32, f'{st} {r}')
        if token:
            st, w = call('POST', f'{URL}/rest/v1/rpc/get_widget_data', {'apikey': PUBLISHABLE}, {'p_token': token})
            check('ウィジェットが予定を読める', st == 200 and w and w['events'][0]['title'] == 'テストの予定', f'{st}')
            st, w = call('POST', f'{URL}/rest/v1/rpc/get_widget_data', {'apikey': PUBLISHABLE}, {'p_token': token[:20]})
            check('合言葉が違うと何も読めない', st == 200 and w is None, f'{st} {w}')

        # 共有カレンダー
        st, cal = call('POST', f'{URL}/rest/v1/rpc/create_shared_calendar', as_user(a),
                       {'p_name': 'テスト共有', 'p_color': '#0f766e', 'p_display_name': 'テストA'})
        check('共有カレンダーを作れる', st == 200 and cal and cal.get('invite_code'), f'{st} {cal}')
        if st == 200 and cal:
            st, r = call('POST', f'{URL}/rest/v1/rpc/join_shared_calendar', as_user(b),
                         {'p_code': cal['invite_code'], 'p_display_name': 'テストB'})
            check('招待コードで参加できる', st == 200, f'{st} {r}')
            st, r = call('POST', f'{URL}/rest/v1/shared_events', as_user(b),
                         {'id': 'e2e-shared-1', 'calendar_id': cal['id'],
                          'data': {'title': '共有の予定', 'date': '2030-01-02', 'time': '15:00'}})
            check('参加した人が予定を追加できる', st in (200, 201), f'{st} {r}')
            st, rows = call('GET', f'{URL}/rest/v1/shared_events?select=id', as_user(a))
            check('作った人にもその予定が見える', st == 200 and [x['id'] for x in rows] == ['e2e-shared-1'], f'{st} {rows}')
            st, rows = call('GET', f'{URL}/rest/v1/notify_queue?user_id=eq.{A_ID}&select=title,body', adm)
            check('作った人への変更のお知らせが用意される',
                  st == 200 and len(rows) == 1 and 'テストB' in rows[0]['body'], f'{st} {rows}')
            st, r = call('DELETE', f'{URL}/rest/v1/shared_members?user_id=eq.{B_ID}', as_user(b))
            st, rows = call('GET', f'{URL}/rest/v1/shared_events?select=id', as_user(b))
            check('抜けたあとは共有の予定が見えない', st == 200 and rows == [], f'{st} {rows}')

        # バックアップ
        st, r = call('POST', f'{URL}/rest/v1/user_backups', as_user(a), {'user_id': A_ID, 'data': data, 'kind': 'manual'})
        check('手動のバックアップを保存できる', st in (200, 201), f'{st} {r}')
        st, r = call('POST', f'{URL}/rest/v1/user_backups', as_user(a), {'user_id': A_ID, 'data': data, 'kind': 'auto'})
        check('自動バックアップのふりはできない', st >= 400, f'{st}')

        # ログイン前
        st, rows = call('GET', f'{URL}/rest/v1/user_data?select=user_id', {'apikey': PUBLISHABLE})
        check('ログインしていない人には何も見えない', st in (401, 403) or rows == [], f'{st}')
    finally:
        cleanup(sk)

    print(f'\n{sum(results)}/{len(results)} OK')
    sys.exit(0 if all(results) else 1)


if __name__ == '__main__':
    main()
