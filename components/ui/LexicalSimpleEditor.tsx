"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import { $createParagraphNode, $getRoot, $getSelection, $isRangeSelection, FORMAT_TEXT_COMMAND } from "lexical";
import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND, ListItemNode, ListNode } from "@lexical/list";
import { Bold, Italic, List, ListOrdered, Underline } from "lucide-react";
import { normalizeCampRichTextHtml } from "@/lib/campsRichText";

type Props = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
};

function ToolbarPlugin() {
  const [editor] = useLexicalComposerContext();
  const [active, setActive] = useState({ bold: false, italic: false, underline: false });

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          setActive({ bold: false, italic: false, underline: false });
          return;
        }
        setActive({
          bold: selection.hasFormat("bold"),
          italic: selection.hasFormat("italic"),
          underline: selection.hasFormat("underline"),
        });
      });
    });
  }, [editor]);

  function ToolButton({
    label,
    isActive,
    onClick,
    children,
  }: {
    label: string;
    isActive?: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) {
    return (
      <button
        type="button"
        className="btn"
        aria-label={label}
        title={label}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        style={isActive ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.24)" } : undefined}
      >
        {children}
      </button>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <ToolButton label="Gras" isActive={active.bold} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}>
        <Bold size={16} />
      </ToolButton>
      <ToolButton label="Italique" isActive={active.italic} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")}>
        <Italic size={16} />
      </ToolButton>
      <ToolButton label="Souligné" isActive={active.underline} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "underline")}>
        <Underline size={16} />
      </ToolButton>
      <ToolButton label="Liste à puces" onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}>
        <List size={16} />
      </ToolButton>
      <ToolButton label="Liste numérotée" onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}>
        <ListOrdered size={16} />
      </ToolButton>
    </div>
  );
}

function replaceEditorRootFromHtml(editor: any, value: string) {
  const normalized = normalizeCampRichTextHtml(value);
  const root = $getRoot();
  root.clear();

  if (!normalized) {
    root.append($createParagraphNode());
    return;
  }

  const parser = new DOMParser();
  const dom = parser.parseFromString(normalized, "text/html");
  const nodes = $generateNodesFromDOM(editor, dom);
  if (nodes.length === 0) {
    root.append($createParagraphNode());
  } else {
    root.append(...nodes);
  }
}

function setEditorHtml(editor: any, value: string) {
  editor.update(() => {
    replaceEditorRootFromHtml(editor, value);
  });
}

function SyncValuePlugin({ value }: { value: string }) {
  const [editor] = useLexicalComposerContext();
  const lastAppliedRef = useRef("");
  const normalized = useMemo(() => normalizeCampRichTextHtml(value), [value]);

  useEffect(() => {
    if (lastAppliedRef.current === normalized) return;
    const current = normalizeCampRichTextHtml(editor.getEditorState().read(() => $generateHtmlFromNodes(editor, null)));
    if (current === normalized) {
      lastAppliedRef.current = normalized;
      return;
    }
    setEditorHtml(editor, normalized);
    lastAppliedRef.current = normalized;
  }, [editor, normalized]);

  return null;
}

export function LexicalSimpleEditor({ value, onChange, placeholder = "" }: Props) {
  const initialConfig = useMemo(
    () => ({
      namespace: "camp-notes-editor",
      theme: {},
      onError(error: Error) {
        throw error;
      },
      nodes: [ListNode, ListItemNode],
      editorState(editor: any) {
        replaceEditorRootFromHtml(editor, value);
      },
    }),
    [value]
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div style={{ display: "grid", gap: 8 }}>
        <ToolbarPlugin />

        <div
          style={{
            position: "relative",
            border: "1px solid rgba(0,0,0,0.14)",
            borderRadius: 12,
            background: "rgba(255,255,255,0.9)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
            padding: 12,
          }}
        >
          <RichTextPlugin
            contentEditable={<ContentEditable className="lexical-camp-editor" />}
            placeholder={<div className="lexical-camp-editor-placeholder">{placeholder}</div>}
            ErrorBoundary={({ children }) => <>{children}</>}
          />
          <HistoryPlugin />
          <ListPlugin />
          <OnChangePlugin
            onChange={(editorState, editor) => {
              editorState.read(() => {
                const html = normalizeCampRichTextHtml($generateHtmlFromNodes(editor, null));
                onChange(html);
              });
            }}
          />
          <SyncValuePlugin value={value} />
        </div>

        <style jsx global>{`
          .lexical-camp-editor {
            min-height: 116px;
            outline: none;
            color: #111827;
            font-size: 14px;
            line-height: 1.5;
          }
          .lexical-camp-editor p {
            margin: 0 0 0.75rem 0;
          }
          .lexical-camp-editor p:last-child {
            margin-bottom: 0;
          }
          .lexical-camp-editor ul,
          .lexical-camp-editor ol {
            margin: 0.4rem 0 0.75rem 1.25rem;
            padding: 0;
          }
          .lexical-camp-editor li {
            margin: 0.15rem 0;
          }
          .lexical-camp-editor-placeholder {
            position: absolute;
            top: 12px;
            left: 12px;
            right: 12px;
            color: rgba(0, 0, 0, 0.38);
            pointer-events: none;
            font-size: 14px;
            line-height: 1.5;
          }
        `}</style>
      </div>
    </LexicalComposer>
  );
}
