"""L2.5：左栏工具区迁移到右栏操作栏 + 项目详情卡。

按标记定位做切片替换，全部为唯一字符串，跑一次即完成：
1. 删左栏「资料库工具」折叠区（含删除项目按钮）与 toolsOpen state
2. 右栏 main 改为「固定操作栏 + 滚动内容」结构，操作栏含全部常规操作与状态卡
3. 未选中记忆时的空状态改为「项目详情」卡
"""
from pathlib import Path

p = Path("src/components/LibraryView.tsx")
text = p.read_text(encoding="utf-8")


def cut_between(text: str, start_marker: str, end_marker: str) -> tuple[str, str]:
    """删除 [start_marker 所在行, end_marker 所在行]，返回 (新文本, 被删内容)。"""
    lines = text.splitlines(keepends=True)
    start = next(i for i, l in enumerate(lines) if start_marker in l)
    end = next(i for i, l in enumerate(lines) if start < i and end_marker in l)
    removed = "".join(lines[start : end + 1])
    return "".join(lines[:start] + lines[end + 1 :]), removed


# ── 1. 删左栏工具折叠区（从注释行到 fragment 闭合 `)}`，即 </> 的下一行）──
text, removed = cut_between(
    text, "L2：左栏顶部原先堆了项目/导入/备份/导出四个区块", "            </>\n"
)
assert "资料库工具" in removed and "deleteLibraryProject()" in removed

# ── 2. 删 toolsOpen state（连同其上注释行）──
text, _ = cut_between(text, "// L2：左栏「资料库工具」折叠区", "useState(false);")

# ── 3. currentProject 派生值（插在 return ( 之前）──
anchor = "  return (\n    <div className=\"flex min-h-0 flex-1 bg-[var(--bg-primary)]\">"
assert text.count(anchor) == 1
current_project = (
    "  // L2.5：当前选中资料库项目的完整对象（右栏详情卡用）。\n"
    "  const currentProject = projects.find((project) => project.id === projectId) ?? null;\n\n"
)
text = text.replace(anchor, current_project + anchor)

# ── 4. main 结构改造 + 操作栏 ──
old_main_open = '<main className="min-w-0 flex-1 overflow-y-auto p-6">'
assert text.count(old_main_open) == 1
new_main_open = """<main className="min-w-0 flex-1 flex flex-col">
        {/* L2.5：资料库级常规操作移到右栏顶部——这是全局操作的标准位置；
            左栏因此只剩纯浏览路径（项目 → 模式 → 搜索筛选 → 列表）。 */}
        <div className="shrink-0 border-b border-[var(--border)] bg-[var(--bg-secondary)] px-6 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void choosePackFile()} disabled={!projectId} className="btn btn-sm btn-secondary" title="导入手机导出的 .svpack 素材包">素材包…</button>
            <button onClick={() => void chooseImportFiles()} disabled={!projectId} className="btn btn-sm btn-secondary" title="直接导入电脑上的音频文件">音频文件…</button>
            <div className="h-5 w-px bg-[var(--border)]" />
            <button onClick={() => void createBackup()} className="btn btn-sm btn-secondary" title="创建整库备份（.svbak，含全部音频）">创建备份</button>
            <button onClick={() => void chooseRestoreFile()} className="btn btn-sm btn-secondary" title="从 .svbak 备份恢复整库">恢复…</button>
            <div className="h-5 w-px bg-[var(--border)]" />
            <button onClick={() => void exportBook()} disabled={!projectId} className="btn btn-sm btn-secondary" title="导出整本回忆录为单个 Markdown，各章节保留来源记忆清单">导出整本…</button>
            <div className="ml-auto" />
            {projectId && (
              <button onClick={() => deleteLibraryProject()} className="btn btn-sm btn-danger" title="删除当前资料库项目及其全部记忆与章节">
                {icons.trash}
                删除项目
              </button>
            )}
          </div>
          {/* 导入 / 恢复的瞬时状态卡：有内容才渲染 */}
          {(packNotice || packPreview || importNotice || importCandidates.length > 0 || backupNotice || restorePreview) && (
            <div className="mt-3 space-y-2">
              {packNotice && <div className="text-xs text-[var(--text-secondary)] break-all">{packNotice}</div>}
              {packPreview && (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-3 space-y-1">
                  <div className="text-xs text-[var(--text-primary)]">
                    记录 {packPreview.recordCount} 条 · 音频 {packPreview.audioCount} 个
                    {packPreview.duplicates > 0 && ` · 重复 ${packPreview.duplicates}`}
                    {packPreview.updates > 0 && ` · 将更新 ${packPreview.updates}`}
                    {packPreview.conflicts > 0 && ` · 冲突 ${packPreview.conflicts}`}
                    {packPreview.missingAudio > 0 && ` · 缺失音频 ${packPreview.missingAudio}`}
                  </div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    导出时间：{formatDate(packPreview.exportedAt)} · 协议 v{packPreview.formatVersion}
                  </div>
                  <button onClick={() => void runPackImport()} className="btn btn-sm btn-primary">导入此素材包</button>
                </div>
              )}
              {importNotice && <div className="text-xs text-[var(--text-secondary)] break-all">{importNotice}</div>}
              {importCandidates.map((candidate) => (
                <div key={candidate.sourcePath} className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-[var(--text-primary)]">{candidate.fileName}</div>
                      <div className="text-xs text-[var(--text-secondary)]">
                        {candidate.format.toUpperCase()}
                        {candidate.durationSecs != null && ` · ${candidate.durationSecs.toFixed(1)}s`}
                        {candidate.sampleRate != null && ` · ${candidate.sampleRate}Hz`}
                        {candidate.alreadyImported && ' · 已导入'}
                      </div>
                    </div>
                    <button
                      onClick={() => void runImport(candidate)}
                      disabled={!!candidate.error || candidate.alreadyImported}
                      className="btn btn-sm btn-primary shrink-0"
                    >
                      导入
                    </button>
                  </div>
                  {candidate.error && <div className="text-xs text-red-600 dark:text-red-300">{candidate.error}</div>}
                </div>
              ))}
              {backupNotice && <div className="text-xs text-[var(--text-secondary)] break-all">{backupNotice}</div>}
              {restorePreview && (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] p-3 space-y-1">
                  <div className="text-xs text-[var(--text-primary)]">
                    备份时间：{formatDate(restorePreview.createdAt)} · 音频 {restorePreview.audioCount} 个
                    {restorePreview.audioMissingLocally > 0 && ` · 本地缺失 ${restorePreview.audioMissingLocally} 个`}
                  </div>
                  <button onClick={() => requestRestore()} className="btn btn-sm btn-primary">恢复此备份</button>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">"""
text = text.replace(old_main_open, new_main_open)

# main 闭合：在 </main> 前补滚动容器闭合
old_close = "        </MemoryEditor>\n        )}\n      </main>"
if old_close not in text:
    # MemoryEditor 分支闭合形式可能不同，退而求其次找 </main>
    idx = text.index("</main>")
    text = text[:idx] + "        </div>\n      " + text[idx:]
else:
    text = text.replace(old_close, "        </MemoryEditor>\n        )}\n        </div>\n      </main>")

# ── 5. 空状态 → 项目详情卡 ──
old_empty = """        ) : !detail ? (
          <div className="flex h-full items-center justify-center text-center text-[var(--text-secondary)]">
            <div className="max-w-sm">
              <div className="text-5xl mb-4">🎙️</div>
              <p className="text-lg font-medium text-[var(--text-primary)]">选择一条记忆，或开始录制新的口述</p>
              <p className="mt-2 text-sm leading-relaxed">原始音频和原始转写会被永久保留。<br/>后续编辑都会创建新版本，不会覆盖原始素材。</p>
            </div>
          </div>
        ) : ("""
assert old_empty in text
new_empty = """        ) : !detail ? (
          <div className="mx-auto w-full max-w-2xl">
            {/* L2.5：未选中记忆时展示当前项目详情——右侧空间不再只有一句提示 */}
            <div className="card p-6 space-y-5">
              <div>
                <div className="text-xs font-semibold uppercase tracking-widest text-[var(--accent)]">项目详情</div>
                <h2 className="mt-1 text-xl font-bold">{currentProject?.name ?? "未选择项目"}</h2>
                {currentProject && (
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    创建于 {formatDate(currentProject.createdAt)} · 最近更新 {formatDate(currentProject.updatedAt)}
                  </p>
                )}
              </div>
              {projectId ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <ProjectStat label="记忆" value={memories.length} />
                  <ProjectStat label="章节" value={chapters.length} />
                  <ProjectStat label="已转写" value={tasks.filter((task) => task.status === "success").length} />
                  <ProjectStat label="待转写" value={tasks.filter((task) => task.status !== "success").length} />
                  <ProjectStat label="人物" value={peopleList.length} />
                  <ProjectStat label="标签" value={tagsList.length} />
                </div>
              ) : (
                <p className="text-sm text-[var(--text-secondary)]">在左侧选择或新建一个资料库项目，即可开始。</p>
              )}
              <div className="border-t border-[var(--border)] pt-4 text-xs leading-relaxed text-[var(--text-secondary)]">
                在左侧选择一条记忆即可查看与编辑；或点左下角「录制口述」开始新的口述。
                <br />
                原始音频和原始转写会被永久保留，后续编辑都会创建新版本，不会覆盖原始素材。
              </div>
            </div>
          </div>
        ) : ("""
text = text.replace(old_empty, new_empty)

p.write_text(text, encoding="utf-8", newline="\n")
print("done")
