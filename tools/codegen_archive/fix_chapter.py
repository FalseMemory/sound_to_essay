with open('src/components/LibraryView.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: change get_chapter to get_chapter_with_drafts
old = "invoke<ChapterWithDrafts | null>('get_chapter', { chapterId })"
new = "invoke<ChapterWithDrafts | null>('get_chapter_with_drafts', { chapterId })"
content = content.replace(old, new)

with open('src/components/LibraryView.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print('OK fix1')
