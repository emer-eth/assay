import { Fragment, type ReactNode } from "react";

// A small Markdown renderer for agent reports: headings, paragraphs, lists, code blocks, **bold** and `code`.
// It builds React elements only (no HTML injection), because the report text comes from an agent.

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    out.push(t.startsWith("**") ? <strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong> : <code key={`${key}-${i++}`} className="font-mono text-[0.92em]">{t.slice(1, -1)}</code>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** `top` is the element a `#`/`##` heading becomes: h3 inside a report (the default), h2 when the text is the page. */
export function Markdown({ text, top = 3 }: { text: string; top?: 2 | 3 }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={k++} className="my-4 overflow-x-auto border border-rule bg-tint p-4 font-mono text-[13px] leading-6">{body.join("\n")}</pre>);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const cls = level <= 2 ? "mt-6 mb-3 text-xl font-semibold first:mt-0" : "mt-5 mb-2 text-[17px] font-semibold first:mt-0";
      const Major = top === 2 ? "h2" : "h3";
      const Minor = top === 2 ? "h3" : "h4";
      blocks.push(level <= 2 ? <Major key={k++} className={cls}>{inline(h[2], `h${k}`)}</Major> : <Minor key={k++} className={cls}>{inline(h[2], `h${k}`)}</Minor>);
      i++;
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, "");
        i++;
        while (i < lines.length && lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*]|\d+\.)\s+/.test(lines[i])) item += " " + lines[i++].trim();
        items.push(item);
      }
      const Tag = ordered ? "ol" : "ul";
      blocks.push(<Tag key={k++} className={`my-3 space-y-2 pl-6 ${ordered ? "list-decimal" : "list-disc"}`}>{items.map((it, j) => <li key={j}>{inline(it, `l${k}-${j}`)}</li>)}</Tag>);
      continue;
    }
    if (/^\|.*\|$/.test(line.trim())) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        if (!/^\|[\s:|-]+\|$/.test(lines[i].trim())) rows.push(lines[i].trim().slice(1, -1).split("|").map((c) => c.trim()));
        i++;
      }
      blocks.push(
        <div key={k++} className="relative my-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <tbody>{rows.map((r, j) => <tr key={j} className={`border-b border-rule ${j === 0 ? "font-semibold" : ""}`}>{r.map((c, n) => <td key={n} className="py-2 pr-4 align-top">{inline(c, `t${k}-${j}-${n}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*]|\d+\.)\s+|\|)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k++} className="my-3">{inline(para.join(" "), `p${k}`)}</p>);
  }
  return <div className="text-[16px] leading-[26px] text-ink">{blocks.map((b, j) => <Fragment key={j}>{b}</Fragment>)}</div>;
}
