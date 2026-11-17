# 2. AI gateway

One module calls every model provider. Nothing else in the app talks to a model API directly.
Reference: `services/api/src/ai/gateway.ts`.

## 2.1 Providers

| Provider | Shape | Key env (first found wins) |
|---|---|---|
| Anthropic (Claude) | Messages API | President, staff, board: `ANTHROPIC_PRESIDENT_API_KEY`, `PRESIDENT_ANTHROPIC_API_KEY`, `ANTHROPIC_API_KEY`. Everything else: `ANTHROPIC_API_KEY` |
| OpenAI | Chat completions | `OPENAI_API_KEY` |
| xAI | OpenAI-compatible | `XAI_API_KEY` |
| Kimi (Moonshot) | OpenAI-compatible | `MOONSHOT_API_KEY`, `KIMI_API_KEY` |
| Voice (Cartesia, ElevenLabs) | Separate voice module | `CARTESIA_API_KEY`, `ELEVENLABS_API_KEY` |

The President's office MUST use its own key, so members' traffic can never drain the Owner's AI.

Plain HTTPS (`fetch`) is RECOMMENDED over vendor SDKs: one code path, easy to stand in for tests. Each base URL SHOULD be overridable by env (MoneyMart: `MM_ANTHROPIC_BASE`) so tests run against a local stand-in.

## 2.2 Messages and tools

The gateway speaks one shape internally — the Anthropic shape — and converts for OpenAI-shaped providers:

```ts
type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };
type Message = { role: 'user' | 'assistant'; content: string | Block[] };
type ToolDef = { name: string; description: string; input_schema: JSONSchema };

call({ seat, role, system, messages, tools?, maxTokens?, timeoutMs?, json? })
  → { ok: true, text, toolUses, content, model, provider, replaced, usage }
  | { ok: false, reason, model, provider }
```

`role` is one of `president | staff | board | ore | quick` and picks the key and the budget.

## 2.3 Seats

A seat is `{ provider, model, backup? }`. Defaults live in code; the Owner overrides any seat with the `ai.seats` setting. Seats: `president`, `finance`, `operations`, `marketing`, `sales`, `tech`, `ore`, `research`, `quick`.

## 2.4 Failure rules

In order, the gateway MUST:

1. Check the role's daily budget first. Over budget → fail (no call).
2. Call the seat's model.
3. If the provider refused the **key** (401/402/403, or 429 about quota/credit/billing) and a second key exists (`<KEY>2`), retry once with it.
4. If it still fails and the seat has a backup model, try the backup once and mark `replaced: true`.
5. A timeout is a failure. It is never silently swapped.

Callers MUST handle `ok: false` and tell the person plainly.

## 2.5 Cost and budgets

- Every call is priced from a price list (USD per million input/output tokens), overridable by `ai.prices`.
- Usage is written to a daily spend table keyed by day + role + model: calls, tokens, USD.
- `aiCostSince(days)` feeds operating cost on the console. Models with no price are listed as unpriced, never counted as zero silently.
- Daily call budgets per role (`ai.budgets`) fail closed.
