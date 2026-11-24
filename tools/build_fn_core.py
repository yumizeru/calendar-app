"""アプリの core.js を、Edge Function（send-reminders）用にコピーする。
core.js を変えたら実行してから、関数を配置し直す。
使い方: python -I tools/build_fn_core.py
"""
import io
import os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
core = io.open(os.path.join(root, 'core.js'), encoding='utf-8').read()
out = os.path.join(root, 'supabase', 'functions', 'send-reminders', 'core.js')
io.open(out, 'w', encoding='utf-8', newline='\n').write(
    '// 自動生成：アプリの core.js のコピー（tools/build_fn_core.py）。手で編集しない\n' + core + '\nexport default Core;\n')
print('wrote', out)
