"use client";

import { useEffect } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { Bold, Italic, List, ListOrdered, Underline as UnderlineIcon } from "lucide-react";
import { normalizeCampRichTextHtml } from "@/lib/campsRichText";

type Props = {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
};

export function TiptapSimpleEditor({ value, onChange, placeholder = "" }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Underline,
    ],
    immediatelyRender: false,
    content: normalizeCampRichTextHtml(value),
    onUpdate: ({ editor: nextEditor }) => {
      onChange(normalizeCampRichTextHtml(nextEditor.getHTML()));
    },
    editorProps: {
      attributes: {
        class: "tiptap-camp-editor",
        "data-placeholder": placeholder,
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const next = normalizeCampRichTextHtml(value);
    if (editor.getHTML() !== next) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [editor, value]);

  if (!editor) return null;

  function ToolButton({
    label,
    active,
    onClick,
    children,
  }: {
    label: string;
    active?: boolean;
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
        style={active ? { background: "rgba(53,72,59,0.12)", borderColor: "rgba(53,72,59,0.24)" } : undefined}
      >
        {children}
      </button>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <ToolButton label="Gras" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={16} />
        </ToolButton>
        <ToolButton label="Italique" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={16} />
        </ToolButton>
        <ToolButton label="Souligné" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon size={16} />
        </ToolButton>
        <ToolButton label="Liste à puces" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={16} />
        </ToolButton>
        <ToolButton label="Liste numérotée" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={16} />
        </ToolButton>
      </div>

      <div
        style={{
          border: "1px solid rgba(0,0,0,0.14)",
          borderRadius: 12,
          background: "rgba(255,255,255,0.9)",
          boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
          padding: 12,
        }}
      >
        <EditorContent editor={editor} />
      </div>

      <style jsx global>{`
        .tiptap-camp-editor {
          min-height: 116px;
          outline: none;
          color: #111827;
          font-size: 14px;
          line-height: 1.5;
          white-space: normal;
        }
        .tiptap-camp-editor p {
          margin: 0 0 0.75rem 0;
        }
        .tiptap-camp-editor p:last-child {
          margin-bottom: 0;
        }
        .tiptap-camp-editor ul,
        .tiptap-camp-editor ol {
          margin: 0.4rem 0 0.75rem 1.25rem;
          padding: 0;
        }
        .tiptap-camp-editor li {
          margin: 0.15rem 0;
        }
        .tiptap-camp-editor p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: rgba(0, 0, 0, 0.38);
          pointer-events: none;
          float: left;
          height: 0;
        }
      `}</style>
    </div>
  );
}
