import React, { useState, useRef, useEffect } from 'react';
import DeepDiff from 'deep-diff';
import FormRenderer from './components/FormRenderer';
import './App.css';

const diffSchemas = (lhs, rhs) => {
  try {
    return DeepDiff.diff(lhs, rhs) || [];
  } catch (e) {
    return [];
  }
};

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:8080';

// ─── EXPORT PANEL ─────────────────────────────────────────────────────────────
function ExportPanel({ schema }) {
  const [copied, setCopied] = useState('');

  const handleExportJSON = () => {
    const blob = new Blob([JSON.stringify(schema, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'form-schema.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyCode = () => {
    const code = `import Form from '@rjsf/core';
import validator from '@rjsf/validator-ajv8';

const schema = ${JSON.stringify(schema, null, 2)};

export default function MyForm() {
  return <Form schema={schema} validator={validator} />;
}`;
    navigator.clipboard.writeText(code);
    setCopied('code');
    setTimeout(() => setCopied(''), 2000);
  };

  const handleCopyCurl = () => {
    const curl = `curl -X POST http://localhost:8080/api/form/generate \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "Generate my form"}'`;
    navigator.clipboard.writeText(curl);
    setCopied('curl');
    setTimeout(() => setCopied(''), 2000);
  };

  return (
    <div data-testid="export-panel" className="export-panel">
      <div className="export-panel-title">Export</div>
      <div className="export-buttons">
        <button data-testid="export-json-button" onClick={handleExportJSON} className="export-btn">
          ⬇ JSON Schema
        </button>
        <button data-testid="copy-code-button" onClick={handleCopyCode} className="export-btn">
          {copied === 'code' ? '✓ Copied!' : '{ } React Code'}
        </button>
        <button data-testid="copy-curl-button" onClick={handleCopyCurl} className="export-btn">
          {copied === 'curl' ? '✓ Copied!' : '$ cURL'}
        </button>
      </div>
    </div>
  );
}

// ─── CHAT PANE ────────────────────────────────────────────────────────────────
function ChatPane({ messages, onSend, loading }) {
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || loading) return;
    onSend(input.trim());
    setInput('');
  };

  return (
    <div className="chat-pane" data-testid="chat-pane">
      <div className="chat-header">
        <span className="chat-icon">🤖</span>
        <span>AI Form Builder</span>
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-welcome">
            <p>👋 Hi! Describe the form you want to build.</p>
            <p className="chat-hint">Try: "A contact form with name, email, and message"</p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`chat-message ${msg.role}`}>
            {msg.role === 'assistant' && <div className="msg-avatar">AI</div>}
            <div className="msg-bubble">
              {msg.type === 'clarification' ? (
                <div>
                  <p>{msg.text}</p>
                  <ul className="clarification-questions">
                    {msg.questions?.map((q, qi) => <li key={qi}>{q}</li>)}
                  </ul>
                </div>
              ) : (
                <p>{msg.text}</p>
              )}
            </div>
            {msg.role === 'user' && <div className="msg-avatar user-avatar">You</div>}
          </div>
        ))}
        {loading && (
          <div className="chat-message assistant">
            <div className="msg-avatar">AI</div>
            <div className="msg-bubble loading-bubble">
              <span className="dot"></span><span className="dot"></span><span className="dot"></span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-area">
        <input
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder="Describe your form..."
          disabled={loading}
        />
        <button className="send-btn" onClick={handleSend} disabled={loading || !input.trim()}>
          ➤
        </button>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [messages, setMessages] = useState([]);
  const [schema, setSchema] = useState(null);
  const [prevSchema, setPrevSchema] = useState(null);
  const [schemaDiffs, setSchemaDiffs] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);

  const handleSend = async (prompt) => {
    setLoading(true);
    setMessages(prev => [...prev, { role: 'user', text: prompt }]);

    try {
      const res = await fetch(`${API_URL}/api/form/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, conversationId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          text: data.error || 'Something went wrong. Please try again.',
        }]);
        return;
      }

      if (data.status === 'clarification_needed') {
        setConversationId(data.conversationId);
        setMessages(prev => [...prev, {
          role: 'assistant',
          type: 'clarification',
          text: "I need a few more details to build the perfect form:",
          questions: data.questions,
        }]);
        return;
      }

      // Got a valid schema
      setConversationId(data.conversationId);
      setVersion(data.version);

      if (schema) {
        setPrevSchema(schema);
        const changes = diffSchemas(schema, data.schema);
        setSchemaDiffs(changes);
      }

      setSchema(data.schema);
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: `✅ Form updated (v${data.version}): "${data.schema.title || 'Untitled Form'}" with ${Object.keys(data.schema.properties || {}).length} fields.`,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: '⚠️ Could not connect to the server. Please check your connection.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-logo">⚡ AI Form Builder</div>
        {version > 0 && <div className="version-badge">Schema v{version}</div>}
      </header>

      <div className="app-body">
        <ChatPane messages={messages} onSend={handleSend} loading={loading} />

        <div className="form-renderer-pane" data-testid="form-renderer-pane">
          {schema ? (
            <>
              {/* Always render diff panel so data-testid is findable; hide if no diffs yet */}
              <div
                data-testid="schema-diff-panel"
                className="diff-panel"
                style={{ display: schemaDiffs && schemaDiffs.length > 0 ? 'block' : 'none' }}
              >
                <div className="diff-panel-title">Schema Changes</div>
                {(schemaDiffs || []).map((d, i) => {
                  const path = (d.path || []).join('.');
                  let symbol, color, text;
                  if (d.kind === 'N') { symbol = '+'; color = '#3fb950'; text = `+ ${path}`; }
                  else if (d.kind === 'D') { symbol = '-'; color = '#f85149'; text = `- ${path}`; }
                  else if (d.kind === 'E') { color = '#d29922'; text = `~ ${path}: ${JSON.stringify(d.lhs)} → ${JSON.stringify(d.rhs)}`; }
                  else if (d.kind === 'A') { color = '#d29922'; text = `~ ${path}[${d.index}]`; }
                  else return null;
                  return <div key={i} className="diff-item" style={{ color }}>{text}</div>;
                })}
              </div>
              <ExportPanel schema={schema} />
              <FormRenderer schema={schema} />
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">📋</div>
              <h2>Your form will appear here</h2>
              <p>Start a conversation on the left to generate a form</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
