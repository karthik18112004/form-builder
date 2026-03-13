require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.API_PORT || 8080;

app.use(cors());
app.use(express.json());

// In-memory conversation store
const conversations = new Map();

// AJV for JSON Schema validation
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

// Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.LLM_API_KEY || 'dummy-key',
});

// ─── SYSTEM PROMPT ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are an expert form builder assistant. Your job is to generate JSON Schema (Draft 7) objects that describe web forms based on user requirements.

CRITICAL RULES:
1. Always respond with a valid JSON object.
2. If the user's request is clear enough, return a form schema object.
3. If the request is ambiguous or lacks key details, return a clarification object.

RESPONSE FORMAT A - Form Schema (when request is clear):
{
  "type": "schema",
  "schema": {
    "$schema": "http://json-schema.org/draft-07/schema#",
    "title": "Form Title",
    "description": "Form description",
    "type": "object",
    "properties": {
      "fieldName": {
        "type": "string",
        "title": "Field Label",
        "description": "Helper text",
        "minLength": 1
      }
    },
    "required": ["fieldName"]
  }
}

RESPONSE FORMAT B - Clarification needed (when request is ambiguous):
{
  "type": "clarification",
  "questions": [
    "Specific clarifying question 1?",
    "Specific clarifying question 2?"
  ]
}

IMPORTANT SCHEMA RULES:
- Use proper JSON Schema Draft 7 types: "string", "number", "integer", "boolean", "array", "object"
- For select/dropdown fields, use "enum" array
- For email fields, use "format": "email"
- For date fields, use "format": "date"
- For conditional fields, use custom property "x-show-when": { "field": "otherFieldName", "equals": value }
- Always include "title" for human-readable labels
- Infer validation rules (minLength, maxLength, minimum, maximum, pattern) from context
- For boolean fields (checkboxes), use "type": "boolean"
- Field names must be camelCase

AMBIGUOUS REQUESTS requiring clarification:
- "booking a meeting room" - needs: what fields are required? date/time range? attendee count? room preferences?
- "a form" - needs: what kind of form? what data to collect?
- Very vague requests with no specific field information

CLEAR REQUESTS that should generate schemas directly:
- "contact form with name and email" - clear enough
- "user signup with email and password" - clear enough
- "survey about favorite colors" - clear enough

When refining an existing form (conversation context provided), modify the existing schema by adding/removing/updating fields as requested. Keep existing fields unless told to remove them.

Only respond with the JSON object, no markdown, no explanation text outside the JSON.`;

// ─── LLM CALL ────────────────────────────────────────────────────────────────
async function callLLM(messages, forceFail = false) {
  if (forceFail) {
    return JSON.stringify({ invalid: 'this is not a valid response', broken: true });
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: messages,
  });

  return response.content[0].text;
}

// ─── PARSE LLM RESPONSE ──────────────────────────────────────────────────────
function parseLLMResponse(text) {
  // Strip markdown code blocks if present
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned);
}

// ─── VALIDATE SCHEMA ─────────────────────────────────────────────────────────
function validateJsonSchema(schema) {
  // Basic structural validation
  if (!schema || typeof schema !== 'object') return { valid: false, errors: ['Schema must be an object'] };
  if (schema.type !== 'object') return { valid: false, errors: ['Schema type must be "object"'] };
  if (!schema.properties || typeof schema.properties !== 'object') {
    return { valid: false, errors: ['Schema must have a properties object'] };
  }
  return { valid: true, errors: [] };
}

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// ─── MAIN FORM GENERATION ENDPOINT ──────────────────────────────────────────
app.post('/api/form/generate', async (req, res) => {
  const { prompt, conversationId } = req.body;
  const mockFailureCount = parseInt(req.query.mock_llm_failure || '0');

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  // Get or create conversation
  let conversation;
  let currentConversationId;

  if (conversationId && conversations.has(conversationId)) {
    conversation = conversations.get(conversationId);
    currentConversationId = conversationId;
  } else {
    currentConversationId = uuidv4();
    conversation = {
      id: currentConversationId,
      messages: [],
      currentSchema: null,
      version: 0,
      formId: uuidv4(),
    };
    conversations.set(currentConversationId, conversation);
  }

  // Build messages for LLM
  const llmMessages = [...conversation.messages];

  // If we have an existing schema, include context
  let userMessage = prompt;
  if (conversation.currentSchema) {
    userMessage = `Current form schema:\n${JSON.stringify(conversation.currentSchema, null, 2)}\n\nUser request: ${prompt}`;
  }

  llmMessages.push({ role: 'user', content: userMessage });

  // Retry logic with mock failure support
  const MAX_RETRIES = 2;
  let lastError = null;
  let failuresLeft = mockFailureCount;
  // Build a running message chain so each retry includes prior error context
  let retryMessages = [...llmMessages];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const shouldFail = failuresLeft > 0;
      if (shouldFail) failuresLeft--;

      const rawResponse = await callLLM(retryMessages, shouldFail);

      let parsed;
      try {
        parsed = parseLLMResponse(rawResponse);
      } catch (e) {
        lastError = `Invalid JSON: ${e.message}`;
        // Accumulate error context for next retry
        retryMessages = [
          ...retryMessages,
          { role: 'assistant', content: rawResponse || 'invalid response' },
          { role: 'user', content: `Your previous attempt failed with this error: "${lastError}". Please respond with only a valid JSON object, no markdown.` },
        ];
        continue;
      }

      // Handle clarification response
      if (parsed.type === 'clarification') {
        conversation.messages.push({ role: 'user', content: prompt });
        conversation.messages.push({ role: 'assistant', content: rawResponse });
        conversations.set(currentConversationId, conversation);

        return res.json({
          status: 'clarification_needed',
          conversationId: currentConversationId,
          questions: parsed.questions,
        });
      }

      // Handle schema response
      if (parsed.type === 'schema' && parsed.schema) {
        const validation = validateJsonSchema(parsed.schema);
        if (!validation.valid) {
          lastError = validation.errors.join(', ');
          // Accumulate validation error context for next retry
          retryMessages = [
            ...retryMessages,
            { role: 'assistant', content: rawResponse },
            { role: 'user', content: `Your previous schema failed validation with this error: "${lastError}". Please correct the schema structure.` },
          ];
          continue;
        }

        // Success! Update conversation
        conversation.messages.push({ role: 'user', content: userMessage });
        conversation.messages.push({ role: 'assistant', content: rawResponse });
        conversation.currentSchema = parsed.schema;
        conversation.version += 1;
        conversations.set(currentConversationId, conversation);

        return res.json({
          formId: conversation.formId,
          conversationId: currentConversationId,
          version: conversation.version,
          schema: parsed.schema,
        });
      }

      lastError = 'Unexpected response format from LLM';
      retryMessages = [
        ...retryMessages,
        { role: 'assistant', content: JSON.stringify(parsed) },
        { role: 'user', content: `Your response was not in the expected format. Please respond with either format A (schema) or format B (clarification) as specified.` },
      ];
    } catch (err) {
      lastError = err.message;
    }
  }

  // All retries failed
  return res.status(500).json({
    error: 'Failed to generate valid schema after multiple attempts.',
    details: lastError,
  });
});

// ─── START SERVER ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Form Builder Backend running on port ${PORT}`);
});
