"""第三批：App.tsx 导航/图标按钮 + StyleSelector + EssayView/PolishView 接入 .btn 规范。"""
from pathlib import Path

REPLACEMENTS = {
    'src/App.tsx': [
        # 设置图标按钮（active 态）
        ("""className={`flex h-9 w-9 items-center justify-center rounded-lg border border-transparent transition ${
              showSettings
                ? 'bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'text-[var(--text-secondary)] hover:border-[var(--border)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
            }`}""",
         """className={`btn btn-icon ${showSettings ? 'btn-active' : 'btn-ghost'}`}"""),
        # 顶部主导航：active 实心 / inactive ghost
        ("""className={`flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition ${
                    active
                      ? 'bg-[var(--accent)] text-white shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}""",
         """className={`btn btn-md ${active ? 'btn-active' : 'btn-ghost'}`}"""),
    ],
    'src/components/StyleSelector.tsx': [
        ('className="px-4 py-2 rounded-lg bg-[var(--bg-tertiary)] text-sm hover:bg-[var(--border)] transition disabled:opacity-50"',
         'className="btn btn-md btn-secondary"'),
        ('className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition disabled:opacity-50"',
         'className="btn btn-md btn-primary"'),
        ('className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] transition disabled:opacity-50 flex items-center gap-2"',
         'className="btn btn-md btn-primary flex items-center gap-2"'),
    ],
    'src/components/EssayView.tsx': [
        ('className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-secondary)] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]"',
         'className="btn btn-sm btn-secondary"'),
        ('className="rounded-lg bg-[var(--success)] px-3 py-1 text-xs text-white transition hover:brightness-110"',
         'className="btn btn-sm btn-success"'),
        ('className="rounded-lg bg-[var(--accent)] px-3 py-1 text-xs text-white transition hover:bg-[var(--accent-hover)]"',
         'className="btn btn-sm btn-primary"'),
    ],
    'src/components/PolishView.tsx': [
        ('className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs text-[var(--text-secondary)] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]"',
         'className="btn btn-sm btn-secondary"'),
        ('className="rounded-lg bg-[var(--success)] px-3 py-1 text-xs text-white transition hover:brightness-110"',
         'className="btn btn-sm btn-success"'),
    ],
}

for path, pairs in REPLACEMENTS.items():
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    for old, new in pairs:
        n = text.count(old)
        if n:
            text = text.replace(old, new)
        print(f"  {path}: {n}x")
    p.write_text(text, encoding="utf-8", newline="\n")
print("done")
