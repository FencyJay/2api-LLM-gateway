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
const GRAY_BADGE = "#64748b";

const OPENAI_MODELS = [
  { id: "gpt-5.2",      desc: "Most capable general-purpose model" },
  { id: "gpt-5.1",      desc: "Strong general-purpose model" },
  { id: "gpt-5",        desc: "GPT-5 base" },
  { id: "gpt-5-mini",   desc: "Cost-effective, high-volume tasks" },
  { id: "gpt-5-nano",   desc: "Fastest and most affordable" },
  { id: "gpt-4.1",      desc: "GPT-4.1 (legacy)" },
  { id: "gpt-4.1-mini", desc: "GPT-4.1-mini (legacy)" },
  { id: "gpt-4.1-nano", desc: "GPT-4.1-nano (legacy)" },
  { id: "gpt-4o",       desc: "GPT-4o (legacy)" },
  { id: "gpt-4o-mini",  desc: "GPT-4o-mini (legacy)" },
  { id: "o4-mini",      desc: "Thinking model — complex reasoning" },
  { id: "o3",           desc: "Most capable thinking model" },
  { id: "o3-mini",      desc: "Efficient thinking model (legacy)" },
];

const ANTHROPIC_MODELS = [
  { id: "claude-opus-4-6",   desc: "Most capable Claude — complex reasoning" },
  { id: "claude-opus-4-5",   desc: "Claude Opus 4.5" },
  { id: "claude-opus-4-1",   desc: "Claude Opus 4.1 (legacy)" },
  { id: "claude-sonnet-4-6", desc: "Balanced performance and speed" },
  { id: "claude-sonnet-4-5", desc: "Claude Sonnet 4.5" },
  { id: "claude-haiku-4-5",  desc: "Fastest Claude — simple tasks" },
];

const ENDPOINTS = [
  { method: "GET",  path: "/v1/models",            type: "Both",     desc: "List all 19 available models (OpenAI + Anthropic)" },
  { method: "POST", path: "/v1/chat/completions",   type: "OpenAI",   desc: "OpenAI-compatible chat completions. Supports all 19 models, streaming, and tool calls. gpt-5+ and o-series use max_completion_tokens automatically." },
  { method: "POST", path: "/v1/messages",           type: "Anthropic",desc: "Anthropic Messages native format. claude-* models are passed through directly; OpenAI models are auto-converted both ways." },
];

const STEPS = [
  { title: "Add Provider", desc: 'Open CherryStudio → Settings → Model Providers → click "+ Add". Choose "OpenAI" or "Anthropic" (both are supported).' },
  { title: "Set Base URL",  desc: "Paste your deployment URL as the Base URL. For OpenAI format the proxy handles /v1/chat/completions; for Anthropic format use /v1/messages." },
  { title: "Enter API Key", desc: "Enter your PROXY_API_KEY as the API Key. This is the Bearer token set at deployment time." },
  { title: "Select a Model & Chat", desc: 'Click "Check" to verify the connection, then pick any of the 19 models and start chatting.' },
];

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback((text: string, key: string) => {
    const fallback = () => {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); document.body.removeChild(ta);
    };
    (navigator.clipboard?.writeText(text) ?? Promise.reject()).catch(fallback).finally(() => {
      setCopied(key); setTimeout(() => setCopied(null), 2000);
    });
    if (!navigator.clipboard) { fallback(); setCopied(key); setTimeout(() => setCopied(null), 2000); }
  }, []);
  return { copied, copy };
}

function CopyBtn({ text, id }: { text: string; id: string }) {
  const { copied, copy } = useCopy();
  return (
    <button onClick={() => copy(text, id)} style={{ background: copied === id ? GREEN : "rgba(255,255,255,0.08)", border: `1px solid ${BORDER}`, color: copied === id ? "#fff" : TEXT_MUTED, borderRadius: 6, padding: "3px 10px", fontSize: 12, cursor: "pointer", transition: "all 0.2s", flexShrink: 0, whiteSpace: "nowrap" }}>
      {copied === id ? "Copied!" : "Copy"}
    </button>
  );
}

function Badge({ label, color }: { label: string; color: string }) {
  return <span style={{ background: color + "22", color, border: `1px solid ${color}44`, borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</span>;
}

function Section({ title, children, badge }: { title: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div style={{ background: BG2, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "24px", marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <h2 style={{ color: TEXT, fontSize: 18, fontWeight: 700, margin: 0 }}>{title}</h2>
        {badge}
      </div>
      {children}
    </div>
  );
}

export default function App() {
  const [online, setOnline] = useState<boolean | null>(null);
  const baseUrl = window.location.origin;

  useEffect(() => {
    fetch("/api/healthz").then((r) => setOnline(r.ok)).catch(() => setOnline(false));
  }, []);

  const curlExample = `curl ${baseUrl}/v1/chat/completions \\
  -H "Authorization: Bearer YOUR_PROXY_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": false
  }'`;

  const totalModels = OPENAI_MODELS.length + ANTHROPIC_MODELS.length;

  return (
    <div style={{ minHeight: "100vh", background: BG, fontFamily: "'Inter', -apple-system, sans-serif", color: TEXT, paddingBottom: 48 }}>

      {/* Header */}
      <div style={{ background: BG2, borderBottom: `1px solid ${BORDER}`, padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64, position: "sticky", top: 0, zIndex: 100 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, background: `linear-gradient(135deg, ${BLUE}, ${PURPLE})`, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>⚡</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>AI Proxy API</div>
            <div style={{ fontSize: 12, color: TEXT_MUTED }}>OpenAI + Anthropic dual-compatible · {totalModels} models</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 10, height: 10, borderRadius: "50%", background: online === null ? "#94a3b8" : online ? GREEN : "#ef4444", boxShadow: online ? `0 0 0 3px ${GREEN}44` : online === false ? "0 0 0 3px #ef444444" : "none", transition: "all 0.3s" }} />
          <span style={{ fontSize: 13, color: TEXT_MUTED }}>{online === null ? "Checking..." : online ? "Online" : "Offline"}</span>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "32px 24px 0" }}>

        {/* Connection Details */}
        <Section title="Connection Details">
          {[
            { label: "Base URL", value: baseUrl, color: BLUE, id: "baseurl" },
            { label: "Auth Header", value: `Authorization: Bearer YOUR_PROXY_API_KEY`, color: PURPLE, id: "auth" },
          ].map((row) => (
            <div key={row.id} style={{ background: BG3, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: TEXT_MUTED, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>{row.label}</div>
                <code style={{ fontSize: 14, color: row.color }}>{row.value}</code>
              </div>
              <CopyBtn text={row.value} id={row.id} />
            </div>
          ))}
        </Section>

        {/* Endpoints */}
        <Section title="API Endpoints">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {ENDPOINTS.map((ep) => {
              const typeColor = ep.type === "OpenAI" ? BLUE : ep.type === "Anthropic" ? ORANGE : GRAY_BADGE;
              const methodColor = ep.method === "GET" ? GREEN : PURPLE;
              return (
                <div key={ep.path} style={{ background: BG3, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
                    <span style={{ background: methodColor + "22", color: methodColor, border: `1px solid ${methodColor}44`, borderRadius: 4, padding: "2px 8px", fontSize: 12, fontWeight: 700, minWidth: 44, textAlign: "center" }}>{ep.method}</span>
                    <code style={{ fontSize: 14, color: TEXT, flex: 1 }}>{ep.path}</code>
                    <Badge label={ep.type} color={typeColor} />
                    <CopyBtn text={`${baseUrl}${ep.path}`} id={`ep-${ep.path}`} />
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: TEXT_MUTED, lineHeight: 1.6 }}>{ep.desc}</p>
                </div>
              );
            })}
          </div>
        </Section>

        {/* Models */}
        <Section title="Available Models" badge={<Badge label={`${totalModels} total`} color={GRAY_BADGE} />}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_MUTED, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <Badge label="OpenAI" color={BLUE} />
              <span>{OPENAI_MODELS.length} models · upstream: localhost:1106/modelfarm/openai</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 8, marginBottom: 20 }}>
              {OPENAI_MODELS.map((m) => (
                <div key={m.id} style={{ background: BG3, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 14px" }}>
                  <code style={{ fontSize: 13, color: TEXT, display: "block", marginBottom: 4 }}>{m.id}</code>
                  <span style={{ fontSize: 11, color: TEXT_MUTED }}>{m.desc}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: TEXT_MUTED, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <Badge label="Anthropic" color={ORANGE} />
              <span>{ANTHROPIC_MODELS.length} models · upstream: localhost:1106/modelfarm/anthropic</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 8 }}>
              {ANTHROPIC_MODELS.map((m) => (
                <div key={m.id} style={{ background: BG3, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "10px 14px" }}>
                  <code style={{ fontSize: 13, color: TEXT, display: "block", marginBottom: 4 }}>{m.id}</code>
                  <span style={{ fontSize: 11, color: TEXT_MUTED }}>{m.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Token param note */}
          <div style={{ background: "rgba(59,130,246,0.08)", border: `1px solid ${BLUE}33`, borderRadius: 8, padding: "10px 14px", marginTop: 8 }}>
            <span style={{ fontSize: 12, color: BLUE }}>
              ⚠ gpt-5.x, gpt-5-mini, gpt-5-nano, o4-mini, o3, o3-mini 需使用 <code>max_completion_tokens</code>，代理会自动将 <code>max_tokens</code> 转换，无需手动处理。
            </span>
          </div>
        </Section>

        {/* CherryStudio Guide */}
        <Section title="CherryStudio 接入指南">
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {STEPS.map((step, i) => (
              <div key={i} style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: `linear-gradient(135deg, ${BLUE}, ${PURPLE})`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, flexShrink: 0, color: "#fff" }}>{i + 1}</div>
                <div style={{ flex: 1, paddingTop: 5 }}>
                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>{step.title}</div>
                  <div style={{ fontSize: 13, color: TEXT_MUTED, lineHeight: 1.7 }}>{step.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Quick Test */}
        <Section title="Quick Test (curl)">
          <div style={{ background: "hsl(222,47%,8%)", border: `1px solid ${BORDER}`, borderRadius: 8, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: `1px solid ${BORDER}`, background: BG3 }}>
              <span style={{ fontSize: 12, color: TEXT_MUTED }}>bash</span>
              <CopyBtn text={curlExample} id="curl" />
            </div>
            <pre style={{ margin: 0, padding: "16px", overflowX: "auto", fontSize: 13, lineHeight: 1.7, fontFamily: "Menlo, Monaco, 'Courier New', monospace" }}>
              {curlExample.split("\n").map((line, i) => {
                const color = line.trim().startsWith("curl") ? BLUE : line.trim().startsWith("-H") ? GREEN : line.trim().startsWith("-d") || line.trim().startsWith("'") || line.trim().startsWith('"') || line.trim().startsWith("}") ? PURPLE : TEXT;
                return <span key={i} style={{ color, display: "block" }}>{line}</span>;
              })}
            </pre>
          </div>
        </Section>

        {/* Footer */}
        <div style={{ textAlign: "center", color: TEXT_MUTED, fontSize: 12, padding: "8px 0", borderTop: `1px solid ${BORDER}` }}>
          Powered by Express · OpenAI SDK v6 · Anthropic SDK · Replit Modelfarm (localhost:1106) · {totalModels} verified models
        </div>
      </div>
    </div>
  );
}
