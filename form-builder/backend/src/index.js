require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
const PORT = process.env.API_PORT || 8080;

app.use(cors());
app.use(express.json());


// In-memory conversation store

const conversations = new Map();


// AJV JSON Schema Validation

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);


// Gemini Client

const genAI = new GoogleGenerativeAI(process.env.LLM_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });


// SYSTEM PROMPT

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

RESPONSE FORMAT B - Clarification needed:
{
  "type": "clarification",
  "questions": [
    "Specific clarifying question 1?",
    "Specific clarifying question 2?"
  ]
}

IMPORTANT SCHEMA RULES:
- Use JSON Schema Draft 7
- Field names must be camelCase
- Email → format: email
- Date → format: date
- Boolean → type: boolean
- Dropdown → enum array
- Conditional fields → "x-show-when": { "field": "...", "equals": value }

Only respond with JSON. No markdown or explanations.`;


// LLM CALL USING GEMINI

async function callLLM(messages, forceFail = false) {

  if (forceFail) {
    return JSON.stringify({ invalid: "mock failure response" });
  }

  try {

    const conversationText = messages
      .map(m => `${m.role}: ${m.content}`)
      .join("\n");

    const prompt = `${SYSTEM_PROMPT}\n\n${conversationText}`;

    const result = await model.generateContent(prompt);

    const response = await result.response;
    const text = response.text();

    console.log("Gemini response:", text);

    return text;

  } catch (err) {

    console.error("Gemini API error:", err);
    throw err;

  }
}


// PARSE LLM RESPONSE

function parseLLMResponse(text) {

  const cleaned = text
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();

  return JSON.parse(cleaned);

}


// BASIC SCHEMA VALIDATION

function validateJsonSchema(schema) {

  if (!schema || typeof schema !== 'object')
    return { valid: false, errors: ['Schema must be an object'] };

  if (schema.type !== 'object')
    return { valid: false, errors: ['Schema type must be "object"'] };

  if (!schema.properties || typeof schema.properties !== 'object')
    return { valid: false, errors: ['Schema must have a properties object'] };

  return { valid: true, errors: [] };

}


// HEALTH ENDPOINT

app.get('/health', (req, res) => {
  res.json({ status: 'healthy' });
});


// FORM GENERATION ENDPOINT

app.post('/api/form/generate', async (req, res) => {

  const { prompt, conversationId } = req.body;
  const mockFailureCount = parseInt(req.query.mock_llm_failure || '0');

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

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

  const llmMessages = [...conversation.messages];

  let userMessage = prompt;

  if (conversation.currentSchema) {

    userMessage =
      `Current form schema:\n${JSON.stringify(conversation.currentSchema, null, 2)}\n\nUser request: ${prompt}`;

  }

  llmMessages.push({ role: 'user', content: userMessage });

  const MAX_RETRIES = 2;

  let lastError = null;
  let failuresLeft = mockFailureCount;
  let retryMessages = [...llmMessages];

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {

    try {

      const shouldFail = failuresLeft > 0;

      if (shouldFail) failuresLeft--;

      console.log(`LLM call attempt ${attempt + 1}${shouldFail ? ' (mock failure)' : ''}`);

      const rawResponse = await callLLM(retryMessages, shouldFail);

      console.log("LLM raw response:", rawResponse);

      let parsed;

      try {

        parsed = parseLLMResponse(rawResponse);

      } catch (e) {

        lastError = `Invalid JSON: ${e.message}`;

        retryMessages = [
          ...retryMessages,
          { role: 'assistant', content: rawResponse },
          { role: 'user', content: `Your previous response failed: ${lastError}. Return only valid JSON.` }
        ];

        continue;

      }

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

      if (parsed.type === 'schema' && parsed.schema) {

        const validation = validateJsonSchema(parsed.schema);

        if (!validation.valid) {

          lastError = validation.errors.join(', ');

          retryMessages = [
            ...retryMessages,
            { role: 'assistant', content: rawResponse },
            { role: 'user', content: `Schema validation failed: ${lastError}. Fix schema.` }
          ];

          continue;

        }

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

      lastError = "Unexpected response format";

    } catch (err) {

      lastError = err.message;

    }

  }

  return res.status(500).json({
    error: "Failed to generate valid schema after multiple attempts.",
    details: lastError,
  });

});


// START SERVER

app.listen(PORT, () => {
  console.log(`Form Builder Backend running on port ${PORT}`);
});