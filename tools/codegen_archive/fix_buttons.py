with open('src/components/LibraryView.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 2: make bottom action buttons larger
content = content.replace(
    'className="flex-1 rounded-lg bg-[var(--bg-tertiary)] px-3 py-2.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--border)] transition flex items-center justify-center gap-1.5"',
    'className="flex-1 rounded-xl bg-[var(--bg-tertiary)] px-4 py-3.5 text-sm font-bold text-[var(--text-primary)] hover:bg-[var(--border)] transition flex items-center justify-center gap-2 shadow-sm"'
)
content = content.replace(
    'className={`flex-1 rounded-lg px-3 py-2.5 text-xs font-semibold text-white disabled:opacity-50 transition flex items-center justify-center gap-1.5 ${recording',
    'className={`flex-1 rounded-xl px-4 py-3.5 text-sm font-bold text-white disabled:opacity-50 transition flex items-center justify-center gap-2 shadow-sm ${recording'
)

with open('src/components/LibraryView.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('OK fix2')
