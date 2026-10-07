"""把 LibraryView 里手写的按钮样式批量收敛到 .btn 规范类。

只做**字面量**替换（不用正则），避免误伤非按钮元素；
替换前后打印每一条的命中次数，便于核对是否如预期。

用法：python tools/apply_button_spec.py <文件>
"""
import sys

# (旧样式串, 新样式串) —— 均为 className 内的字面量
REPLACEMENTS = [
    # 文字链接（此前 10px + hover:underline，最显眼的一类）
    ('className="text-[10px] font-medium text-[var(--accent)] hover:underline"',
     'className="btn btn-sm btn-ghost"'),
    ('className="text-[10px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent)] hover:underline"',
     'className="btn btn-sm btn-ghost"'),
    # 次要按钮：两个等宽（素材包 / 音频文件）
    ('className="flex-1 rounded-lg border border-[var(--border)] px-2 py-1.5 text-[11px] font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-tertiary)]"',
     'className="btn btn-sm btn-secondary flex-1"'),
    # 主按钮（小号）
    ('className="rounded-lg bg-[var(--accent)] px-3 py-1 text-[11px] font-semibold text-white hover:bg-[var(--accent-hover)] transition"',
     'className="btn btn-sm btn-primary"'),
    ('className="rounded-lg bg-[var(--accent)] px-4 py-1 text-[11px] font-semibold text-white hover:bg-[var(--accent-hover)] transition"',
     'className="btn btn-sm btn-primary"'),
    ('className="shrink-0 rounded-lg bg-[var(--accent)] px-2.5 py-1 text-[10px] font-semibold text-white hover:bg-[var(--accent-hover)] transition disabled:opacity-40"',
     'className="btn btn-sm btn-primary shrink-0"'),
    # 主按钮（中号，带阴影，用于「保存元数据」等）
    ('className="rounded-lg bg-[var(--accent)] px-5 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition shadow-sm shadow-blue-500/20"',
     'className="btn btn-md btn-primary"'),
    # 危险操作（移入回收站 / 删除）
    ('className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-500/10 transition"',
     'className="btn btn-sm btn-danger"'),
    ('className="rounded-lg border border-red-500/20 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/40 transition font-medium"',
     'className="btn btn-sm btn-danger"'),
    ('className="shrink-0 rounded-lg border border-red-500/20 px-3 py-1.5 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:border-red-500/40 transition font-medium"',
     'className="btn btn-sm btn-danger shrink-0"'),
    ('className="shrink-0 rounded-lg border border-red-500/20 px-3 py-1 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 transition font-medium"',
     'className="btn btn-sm btn-danger shrink-0"'),
    # 描边强调（开始转写 / 重新转写 / 恢复）
    ('className="rounded-lg border border-[var(--accent)]/40 px-3 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 transition"',
     'className="btn btn-sm btn-secondary"'),
    ('className="shrink-0 rounded-lg border border-[var(--accent)]/40 px-3 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 transition"',
     'className="btn btn-sm btn-secondary shrink-0"'),
    ('className="rounded-lg border border-[var(--accent)]/40 px-4 py-2 text-xs font-semibold text-[var(--accent)] hover:bg-[var(--accent)]/10 transition flex items-center gap-1.5"',
     'className="btn btn-md btn-secondary flex items-center gap-1.5"'),
    # 章节选中态（保留选中高亮，但统一尺寸）
    ('className="rounded-lg border border-[var(--accent)]/30 px-3 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 transition"',
     'className="btn btn-sm btn-secondary"'),
    # 通用次要（无强调色）
    ('className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)]"',
     'className="btn btn-sm btn-secondary"'),
    ('className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--accent)] hover:bg-[var(--accent)]/10 hover:border-[var(--accent)]/30 transition font-medium"',
     'className="btn btn-sm btn-secondary"'),

    # --- 第二批：带 disabled / flex / shadow 变体的按钮 ---
    # 「重新转写」等可禁用按钮（.btn 自带 disabled 样式，去掉 disabled:opacity-50）
    ('className="rounded-lg border border-[var(--accent)]/40 px-3 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 transition disabled:opacity-50"',
     'className="btn btn-sm btn-secondary"'),
    ('className="rounded-lg border border-[var(--accent)]/40 px-4 py-1.5 text-xs font-medium text-[var(--accent)] hover:bg-[var(--accent)]/10 transition"',
     'className="btn btn-sm btn-secondary"'),
    ('className="rounded-lg bg-[var(--accent)] px-5 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition shadow-sm shadow-blue-500/20 flex items-center gap-1.5"',
     'className="btn btn-md btn-primary flex items-center gap-1.5"'),
    ('className="rounded-lg bg-[var(--accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition disabled:opacity-50 flex items-center gap-1.5"',
     'className="btn btn-md btn-primary flex items-center gap-1.5"'),
    ('className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--accent-hover)] transition shadow-sm shadow-blue-500/20"',
     'className="btn btn-sm btn-primary"'),
]


def main() -> int:
    if len(sys.argv) < 2:
        print("用法: python tools/apply_button_spec.py <文件>")
        return 1
    path = sys.argv[1]
    with open(path, encoding="utf-8") as handle:
        text = handle.read()

    total = 0
    for old, new in REPLACEMENTS:
        count = text.count(old)
        if count:
            text = text.replace(old, new)
            total += count
            print(f"  {count}x  {old[:64]}...")
    print(f"\n共替换 {total} 处")

    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
