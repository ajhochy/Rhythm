import { createElement, Fragment, useState, type ReactNode } from 'react';
import { marked, type Token, type Tokens } from 'marked';

function Code({ text, language }: { text: string; language?: string }) {
  const [status, setStatus] = useState('');
  return <div><pre><code className={language ? `language-${language}` : undefined}>{text}</code></pre><button type="button" onClick={() => void navigator.clipboard.writeText(text).then(() => setStatus('Code copied'), () => setStatus('Code copy failed'))}>Copy code</button><span role="status">{status}</span></div>;
}

// Lexer only: React owns every DOM node. No HTML injection, image loads, or navigation.
function render(tokens: Token[]): ReactNode {
  return tokens.map((token, i) => {
    const nested = () => render('tokens' in token ? token.tokens ?? [] : []);
    let node: ReactNode;
    switch (token.type) {
      case 'heading': node = createElement(`h${token.depth}`, null, nested()); break;
      case 'paragraph': node = <p>{nested()}</p>; break;
      case 'text': node = token.tokens ? nested() : token.text; break;
      case 'strong': node = <strong>{nested()}</strong>; break;
      case 'em': node = <em>{nested()}</em>; break;
      case 'del': node = <del>{nested()}</del>; break;
      case 'codespan': node = <code>{token.text}</code>; break;
      case 'code': node = <Code text={`${token.text}\n`} language={token.lang} />; break;
      case 'blockquote': node = <blockquote>{nested()}</blockquote>; break;
      case 'list': {
        const list = token as Tokens.List;
        const items = list.items.map((item, index) => <li key={index}>{item.task && <input type="checkbox" checked={item.checked} readOnly aria-label={item.checked ? 'Completed' : 'Not completed'} />}{render(item.tokens)}</li>);
        node = list.ordered ? <ol start={list.start || 1}>{items}</ol> : <ul>{items}</ul>; break;
      }
      case 'table': {
        const table = token as Tokens.Table;
        node = <table><thead><tr>{table.header.map((cell, index) => <th key={index} scope="col">{render(cell.tokens)}</th>)}</tr></thead><tbody>{table.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{render(cell.tokens)}</td>)}</tr>)}</tbody></table>; break;
      }
      case 'link': {
        const safe = /^https?:\/\//i.test(token.href) && !/[\u0000-\u0020\u007f]/.test(token.href);
        node = safe ? <span><span role="link" aria-disabled="true" title={token.href}>{nested()}</span><small> (External link opening unavailable: {token.href})</small></span> : <span>{nested()} (Unsafe link blocked)</span>; break;
      }
      case 'image': node = <span>{token.text} (Image loading disabled)</span>; break;
      case 'html': node = token.raw; break;
      case 'br': node = <br />; break;
      case 'hr': node = <hr />; break;
      case 'space': node = null; break;
      default: node = token.raw;
    }
    return <Fragment key={i}>{node}</Fragment>;
  });
}

export function SafeMarkdown({ content }: { content: string }) {
  return <div className="markdown-copy">{render(marked.lexer(content, { gfm: true }))}</div>;
}
