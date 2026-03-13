# AI-Powered Conversational Form Builder

A full-stack application that uses a conversational AI (Claude) to generate complex web forms from natural language descriptions, enforcing structured JSON Schema outputs.

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose installed
- An Anthropic API key (or OpenAI/Gemini)

### Setup

1. Clone the repository
2. Create the backend environment file:

```bash
cp backend/.env.example backend/.env
# Edit backend/.env and set your LLM_API_KEY
```

3. Start the application:

```bash
docker-compose up --build
```

4. Open [http://localhost:3000](http://localhost:3000) in your browser.

The backend API is available at [http://localhost:8080](http://localhost:8080).

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Browser (React)                    │
│  ┌──────────────┐        ┌───────────────────────┐  │
│  │  Chat Pane   │        │  Form Renderer Pane   │  │
│  │  (left side) │        │  (right side)         │  │
│  │              │        │  - Live form preview  │  │
│  │  Conversation│        │  - Schema diff panel  │  │
│  │  history     │        │  - Export panel       │  │
│  └──────────────┘        └───────────────────────┘  │
└──────────────────────────┬──────────────────────────┘
                           │ REST API
                           ▼
┌─────────────────────────────────────────────────────┐
│              Node.js Express Backend                  │
│                                                       │
│  POST /api/form/generate                              │
│  ┌─────────────────────────────────────────────┐    │
│  │  1. Look up conversation history (in-memory)│    │
│  │  2. Build LLM messages with context         │    │
│  │  3. Call Anthropic API (claude-sonnet)      │    │
│  │  4. Parse & validate JSON Schema output     │    │
│  │  5. Retry up to 2x on validation failure    │    │
│  │  6. Return schema or clarification          │    │
│  └─────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────┘
                           │
                           ▼
              ┌─────────────────────┐
              │   Anthropic API     │
              │  claude-sonnet-4    │
              └─────────────────────┘
```

### Project Structure

```
form-builder/
├── docker-compose.yml          # Orchestrates both services
├── README.md
├── backend/
│   ├── Dockerfile
│   ├── .env.example            # Environment variable template
│   ├── package.json
│   └── src/
│       └── index.js            # Express server + all API logic
└── frontend/
    ├── Dockerfile              # Multi-stage: build → nginx
    ├── nginx.conf
    ├── package.json
    └── src/
        ├── index.js
        ├── App.js              # Main app, state, chat + layout
        ├── App.css
        └── components/
            └── FormRenderer.js # Custom JSON Schema form renderer
```

---

## 📡 API Reference

### `GET /health`
Returns service health status.

**Response:**
```json
{ "status": "healthy" }
```

---

### `POST /api/form/generate`

Generates or refines a form schema from a natural language prompt.

**Request Body:**
```json
{
  "prompt": "A contact form with name, email, and message",
  "conversationId": "optional-uuid-for-multi-turn"
}
```

**Response — Schema Generated:**
```json
{
  "formId": "uuid",
  "conversationId": "uuid",
  "version": 1,
  "schema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "Contact Form",
    "type": "object",
    "properties": {
      "name": { "type": "string", "title": "Name" },
      "email": { "type": "string", "title": "Email", "format": "email" },
      "message": { "type": "string", "title": "Message" }
    },
    "required": ["name", "email"]
  }
}
```

**Response — Clarification Needed:**
```json
{
  "status": "clarification_needed",
  "conversationId": "uuid",
  "questions": [
    "What date/time range fields are needed?",
    "Should attendees be able to add notes?"
  ]
}
```

**Query Parameters (for testing):**
- `?mock_llm_failure=1` — Simulates 1 LLM failure, then succeeds
- `?mock_llm_failure=3` — Simulates 3 failures, returns 500 error

---

## 🎨 Frontend Features

### Split-Pane Layout
- **Left pane** (`data-testid="chat-pane"`): Conversational interface
- **Right pane** (`data-testid="form-renderer-pane"`): Live form preview

### Live Form Rendering
The form updates in real-time after each successful schema generation. All fields are tagged with `data-testid="field-{fieldName}"`.

### Conditional Logic (`x-show-when`)
Custom schema extension for conditional field visibility:
```json
"emailFrequency": {
  "type": "string",
  "title": "Email Frequency",
  "x-show-when": { "field": "sendNewsletter", "equals": true }
}
```
The `emailFrequency` field only renders when `sendNewsletter` is `true`.

### Schema Diff Panel (`data-testid="schema-diff-panel"`)
Appears after the second schema version. Shows:
- `+ fieldName` — Added fields
- `- fieldName` — Removed fields  
- `~ fieldName` — Modified fields

### Export Panel (`data-testid="export-panel"`)
Three export actions:
- `data-testid="export-json-button"` — Download JSON Schema file
- `data-testid="copy-code-button"` — Copy React component code
- `data-testid="copy-curl-button"` — Copy cURL command

---

## 🔧 Design Choices

### Why Anthropic's Claude?
Claude's instruction-following capabilities make it reliable for structured output generation. The system prompt enforces strict JSON response formats with two explicit response types: `schema` and `clarification`.

### Prompt Engineering Strategy
The system prompt uses:
1. **Explicit format specification** with JSON examples for both response types
2. **Clear ambiguity rules** — lists which types of requests need clarification vs. can be answered directly
3. **Context injection** — existing schema is prepended to refinement requests so Claude modifies rather than recreates

### Validation & Retry Logic
Server-side validation with AJV runs after every LLM response. On failure:
1. The error message is injected into a new prompt
2. Claude is asked to self-correct
3. Up to 2 retries before returning a 500 error

### In-Memory State
Conversations are stored in a `Map` keyed by UUID. This is appropriate for development; a production system would use Redis or a database for persistence and scalability.

### Custom Form Renderer
Rather than using `@rjsf/core`, a custom renderer was built to:
- Natively support the `x-show-when` conditional logic
- Apply consistent dark-theme styling
- Add `data-testid` attributes required for testing

---

## 🧪 Testing

Run against the live application using Playwright or curl:

```bash
# Health check
curl http://localhost:8080/health

# Generate a form
curl -X POST http://localhost:8080/api/form/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "A contact form with name and email"}'

# Test ambiguity detection
curl -X POST http://localhost:8080/api/form/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Make a form for booking a meeting room"}'

# Test retry mechanism (1 failure then success)
curl -X POST "http://localhost:8080/api/form/generate?mock_llm_failure=1" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "A simple contact form"}'

# Test all retries fail (returns 500)
curl -X POST "http://localhost:8080/api/form/generate?mock_llm_failure=3" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "A simple contact form"}'
```
