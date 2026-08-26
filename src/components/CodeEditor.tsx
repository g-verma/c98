'use client'

import { useEffect, useRef, useState } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { html } from '@codemirror/lang-html'
import { css } from '@codemirror/lang-css'
import { oneDark } from '@codemirror/theme-one-dark'
import { basicSetup } from 'codemirror'

export interface CodeEditorApi {
  updateCode: (code: string) => void
}

interface CodeEditorProps {
  initialCode: string
  language: string
  onChange: (code: string) => void
  onEditorReady?: (api: CodeEditorApi) => void
}

function getLanguageExtension(lang: string) {
  switch (lang) {
    case 'javascript': return javascript({ jsx: true })
    case 'typescript': return javascript({ typescript: true, jsx: true })
    case 'python': return python()
    case 'html': return html()
    case 'css': return css()
    default: return []
  }
}

export default function CodeEditor({ initialCode, language, onChange, onEditorReady }: CodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const isRemoteUpdate = useRef(false)
  const languageCompartment = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  const lastHoverLine = useRef<number | null>(null)
  const [replyBtn, setReplyBtn] = useState<{ lineNum: number; top: number } | null>(null)

  // Keep onChangeRef current without causing editor re-creation
  useEffect(() => {
    onChangeRef.current = onChange
  })

  // Create editor once on mount
  useEffect(() => {
    if (!containerRef.current) return

    const state = EditorState.create({
      doc: initialCode,
      extensions: [
        basicSetup,
        languageCompartment.current.of(getLanguageExtension(language)),
        oneDark,
        EditorView.theme({
          '&': { height: '100%', backgroundColor: '#000000' },
          '.cm-scroller': {
            fontFamily: '"Fira Code", "JetBrains Mono", "Cascadia Code", ui-monospace, monospace',
            fontSize: '13.5px',
            lineHeight: '1.65',
            backgroundColor: '#000000'
          },
          '.cm-content': { padding: '16px 0', caretColor: '#58a6ff' },
          '.cm-focused': { outline: 'none' },
          '.cm-gutters': { backgroundColor: '#000000 !important', borderRight: '1px solid #21262d', color: '#484f58' },
          '.cm-lineNumbers .cm-gutterElement': { paddingLeft: '16px', paddingRight: '12px' },
          '.cm-activeLine': { backgroundColor: '#161b22' },
          '.cm-activeLineGutter': { backgroundColor: '#161b22' },
          '.cm-selectionBackground, .cm-focused .cm-selectionBackground': { backgroundColor: '#264f7840 !important' },
          '.cm-cursor': { borderLeftColor: '#58a6ff' },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !isRemoteUpdate.current) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
      ],
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view

    onEditorReady?.({
      updateCode: (newCode: string) => {
        const currentCode = view.state.doc.toString()
        if (currentCode === newCode) return
        isRemoteUpdate.current = true
        view.dispatch({ changes: { from: 0, to: currentCode.length, insert: newCode } })
        isRemoteUpdate.current = false
      },
    })

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update language via compartment (no full re-render)
  useEffect(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      effects: languageCompartment.current.reconfigure(getLanguageExtension(language)),
    })
  }, [language])

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const view = viewRef.current
    const wrapper = wrapperRef.current
    if (!view || !wrapper) return
    const rect = wrapper.getBoundingClientRect()
    // Try mouse position first; fall back to a fixed X inside content for gutter hover
    let pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    if (pos === null) pos = view.posAtCoords({ x: rect.left + 150, y: e.clientY })
    if (pos === null) { setReplyBtn(null); lastHoverLine.current = null; return }
    const line = view.state.doc.lineAt(pos)
    if (!line.text.trim()) { setReplyBtn(null); lastHoverLine.current = null; return }
    if (lastHoverLine.current === line.number) return  // same line, skip re-render
    lastHoverLine.current = line.number
    const coords = view.coordsAtPos(line.from)
    if (!coords) { setReplyBtn(null); return }
    const top = coords.top - rect.top
    if (top < 0 || top > rect.height) { setReplyBtn(null); return }
    setReplyBtn({ lineNum: line.number, top })
  }

  const handleReplyClick = () => {
    const view = viewRef.current
    if (!view || !replyBtn) return
    const line = view.state.doc.line(replyBtn.lineNum)
    view.dispatch({
      changes: { from: line.to, insert: '\n' },
      selection: { anchor: line.to + 1 },
    })
    view.focus()
    setReplyBtn(null)
    lastHoverLine.current = null
  }

  return (
    <div
      ref={wrapperRef}
      className="h-full w-full relative overflow-hidden"
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { setReplyBtn(null); lastHoverLine.current = null }}
    >
      {replyBtn && (
        <button
          onMouseDown={(e) => { e.preventDefault(); handleReplyClick() }}
          style={{ top: replyBtn.top + 3, left: 2 }}
          className="absolute z-20 flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 hover:text-blue-400 bg-[#0d1117]/90 hover:bg-blue-500/10 rounded border border-gray-700/40 hover:border-blue-500/40 transition-colors select-none"
        >
          ↩ Reply
        </button>
      )}
      <div ref={containerRef} className="h-full w-full" />
    </div>
  )
}
