import { useState, useEffect, useCallback } from "react";

const BG = "hsl(222,47%,11%)";
const BG2 = "hsl(222,47%,15%)";
const BG3 = "hsl(222,47%,19%)";
const BORDER = "rgba(255,255,255,0.1)";
const TEXT = "#e2e8f0";
const TEXT_MUTED = "#94a3b8";
const BLUE = "#3b82f6";
const PURPLE = "#a855f7";
const GREEN = "#22c55e";
const ORANGE = "#f97316";
const GRAY_BADGE = "#475569";

const MODELS = [
  { id: "gpt-5.2", provider: "OpenAI" },
  { id: "gpt-5-mini", provider: "OpenAI" },
  { id: "gpt-5-nano", provider: "OpenAI" },
  { id: "o4-mini", provider: "OpenAI" },
  { id: "o3", provider: "OpenAI" },
  { id: "claude-opus-4-6", provider: "Anthropic" },
  { id: "claude-sonnet-4-6", provider: "Anthropic" },
  { id: "claude-haiku-4-5", provider: "Anthropic" },
];

const ENDPOINTS = [
  {
    method: "GET",
    path: "/v1/models",
    type: "Both",
    desc: "List all available models (OpenAI + Anthropic)",
  },
  {
    method: "POST",
    path: "/v1/chat/completions",
    type: "OpenAI",
    desc: "OpenAI-compatible chat completions — supports streaming, tool calls, and all gpt-*/o* models as well as claude-* models",
  },
  {
    method: "POST",
    path: "/v1/messages",
    type: "Anthropic",
    desc: "Anthropic Messages native format — use for claude-* models natively; OpenAI models are automatically converted",
  },
];

const STEPS = [
  {
    title: "Add Provider",
    desc: 'Open CherryStudio → Settings → Model Providers → click "+ Add". Choose "OpenAI" or "Anthropic" (either format is supported).',
  },
  {
    title: "Set Base URL",
    desc: "Paste your deployment URL as the Base URL. For OpenAI format use the root domain; for Anthropic format add /v1 — the proxy handles both.",
  },
  {
    title: "Enter API Key",
    desc: "Enter your PROXY_API_KEY as the API Key. This is the Bearer token you set when deploying.",
  },
  {
    title: "Select a Model & Chat",
    desc: 'Click "Check" to verify the connection, then choose any model from the list and start chatting.',
  },
];

function useCopy(timeout = 2000) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((text: string, key: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(key);
        setTimeout(() => setCopied(null), timeout);
      });
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(key);
      setTimeout(() => setCopied(null), timeout);
    }
  }, [timeout]);
  return { copied, copy };
}

function CopyBtn({ text, id }: { text: string; id: string }) {
  const { copied, copy } = useCopy();
  return (
    <button
      onClick={() => copy(text, id)}
      style={{
        background: copied === id ? GREEN : "rgba(255,255,255,0.08)",
        border: `1px solid ${BORDER}`,
        color: copied === id ? "#fff" : TEXT_MUTED,
        borderRadius: 6,
        padding: "3px 10px",
        fontSize: 12,
        cursor: "pointer",
        transition: "all 0.2s",
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      {copied === id ? "Copied!" : "Copy"}
    </button>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        background: color + "22",
        color,
        border: `1px solid ${color}44`,
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}
    >
      {label}
    </span>
  );
}

function MethodBadge({ method }: { method: string }) {
  return (
    <span
      style={{
        background: method === "GET" ? GREEN + "22" : PURPLE + "22",
        color: method === "GET" ? GREEN : PURPLE,
        border: `1px solid ${method === "GET" ? GREEN : PURPLE}44`,
        borderRadius: 4,
        padding: "2px 8px",
        fontSize: 12,
        fontWeight: 700,
        minWidth: 48,
        textAlign: "center",
      }}
    >
      {method}
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: BG2,
        border: `1px solid ${BORDER}`,
        borderRadius: 12,
        padding: "24px",
        marginBottom: 24,
      }}
    >
      <h2 style={{ color: TEXT, fontSize: 18, fontWeight: 700, marginBottom: 16, margin: "0 0 16px" }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

export default function App() {
  const [online, setOnline] = useState<boolean | null>(null);
  const baseUrl = window.location.origin;
  const authHeader = `Authorization: Bearer YOUR_PROXY_API_KEY`;

  useEffect(() => {
    fetch("/api/healthz")
      .then((r) => setOnline(r.ok))
      .catch(() => setOnline(false));
  }, []);

  const curlExample = `curl ${baseUrl}/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_PROXY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'`;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: BG,
        fontFamily: "'Inter', -apple-system, sans-serif",
        color: TEXT,
        padding: "0 0 48px",
      }}
    >
      {/* Header */}
      <div
        style={{
          background: BG2,
          borderBottom: `1px solid ${BORDER}`,
          padding: "0 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          height: 64,
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              background: `linear-gradient(135deg, ${BLUE}, ${PURPLE})`,
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
            }}
          >
            ⚡
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>AI Proxy API</div>
            <div style={{ fontSize: 12, color: TEXT_MUTED }}>OpenAI + Anthropic dual-compatible</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: online === null ? "#94a3b8" : online ? GREEN : "#ef4444",
              boxShadow: online
                ? `0 0 0 3px ${GREEN}44`
                : online === false
                ? "0 0 0 3px #ef444444"
                : "none",
              transition: "all 0.3s",
            }}
          />
          <span style={{ fontSize: 13, color: TEXT_MUTED }}>
            {online === null ? "Checking..." : online ? "Online" : "Offline"}
          </span>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px 0" }}>

        {/* Connection Details */}
        <Section title="Connection Details">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div
              style={{
                background: BG3,
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
                padding: "12px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>Base URL</div>
                <code style={{ fontSize: 14, color: BLUE }}>{baseUrl}</code>
              </div>
              <CopyBtn text={baseUrl} id="baseurl" />
            </div>
            <div
              style={{
                background: BG3,
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
                padding: "12px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>Auth Header</div>
                <code style={{ fontSize: 14, color: PURPLE }}>{authHeader}</code>
              </div>
              <CopyBtn text={authHeader} id="auth" />
            </div>
          </div>
        </Section>

        {/* Endpoints */}
        <Section title="API Endpoints">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {ENDPOINTS.map((ep) => {
              const fullUrl = `${baseUrl}${ep.path}`;
              const typeColor = ep.type === "OpenAI" ? BLUE : ep.type === "Anthropic" ? ORANGE : GRAY_BADGE;
              return (
                <div
                  key={ep.path}
                  style={{
                    background: BG3,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 8,
                    padding: "14px 16px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                    <MethodBadge method={ep.method} />
                    <code style={{ fontSize: 14, color: TEXT, flex: 1 }}>{ep.path}</code>
                    <Badge label={ep.type} color={typeColor} />
                    <CopyBtn text={fullUrl} id={`ep-${ep.path}`} />
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: TEXT_MUTED, lineHeight: 1.6 }}>{ep.desc}</p>
                </div>
              );
            })}
          </div>
        </Section>

        {/* Available Models */}
        <Section title="Available Models">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 10,
            }}
          >
            {MODELS.map((m) => (
              <div
                key={m.id}
                style={{
                  background: BG3,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  padding: "12px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <code style={{ fontSize: 13, color: TEXT }}>{m.id}</code>
                <Badge label={m.provider} color={m.provider === "OpenAI" ? BLUE : ORANGE} />
              </div>
            ))}
          </div>
        </Section>

        {/* CherryStudio Setup */}
        <Section title="CherryStudio Setup Guide">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {STEPS.map((step, i) => (
              <div key={i} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "50%",
                    background: `linear-gradient(135deg, ${BLUE}, ${PURPLE})`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 15,
                    flexShrink: 0,
                    color: "#fff",
                  }}
                >
                  {i + 1}
                </div>
                <div style={{ flex: 1, paddingTop: 4 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{step.title}</div>
                  <div style={{ fontSize: 13, color: TEXT_MUTED, lineHeight: 1.7 }}>{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Quick Test */}
        <Section title="Quick Test (curl)">
          <div
            style={{
              background: "hsl(222,47%,8%)",
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 16px",
                borderBottom: `1px solid ${BORDER}`,
                background: BG3,
              }}
            >
              <span style={{ fontSize: 12, color: TEXT_MUTED }}>bash</span>
              <CopyBtn text={curlExample} id="curl" />
            </div>
            <pre
              style={{
                margin: 0,
                padding: "16px",
                overflowX: "auto",
                fontSize: 13,
                lineHeight: 1.7,
                fontFamily: "Menlo, Monaco, 'Courier New', monospace",
              }}
            >
              {curlExample.split("\n").map((line, i) => {
                let color = TEXT;
                if (line.trim().startsWith("-H")) color = GREEN;
                else if (line.trim().startsWith("-d")) color = PURPLE;
                else if (line.trim().startsWith("curl")) color = BLUE;
                return (
                  <span key={i} style={{ color, display: "block" }}>
                    {line}
                  </span>
                );
              })}
            </pre>
          </div>
        </Section>

        {/* Footer */}
        <div
          style={{
            textAlign: "center",
            color: TEXT_MUTED,
            fontSize: 13,
            padding: "8px 0",
            borderTop: `1px solid ${BORDER}`,
          }}
        >
          Powered by Express · OpenAI SDK · Anthropic SDK · Deployed on Replit
        </div>
      </div>
    </div>
  );
}
