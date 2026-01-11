import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Import PayForeman routes
import invoiceRoutes from './routes/invoices';
import deadlineRoutes from './routes/deadlines';
import projectRoutes from './routes/projects';
import emailRoutes from './routes/emails';
import chatRoutes from './routes/chat';
import notificationRoutes from './routes/notifications';
import authRoutes from './routes/auth';
import { testConnection } from './utils/database';

// Load .env file if it exists (for local development)
// In Docker, environment variables are provided by docker-compose
const envPath = path.resolve(__dirname, '../../.env');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  // In Docker or production, variables should already be in environment
  console.log('No .env file found, using environment variables from container');
}

const app = express();
const PORT = process.env.API_PORT || 3001;

// Validate required environment variables
const requiredEnvVars = [
  'NEXT_PUBLIC_TENANT_ID',
  'NEXT_PUBLIC_PROJECT_ID',
  'NEXT_PUBLIC_API_KEY',
  'NEXT_PUBLIC_SECRET_API_KEY',
  'NEXT_PUBLIC_AUTH_API_URL',
  'NEXT_PUBLIC_NOTIFICATIONS_API_URL',
  'NEXT_PUBLIC_MAILER_API_URL',
  'NEXT_PUBLIC_LLM_API_URL',
  'NEXT_PUBLIC_CMS_API_URL',
  'NEXT_PUBLIC_BILLING_API_URL',
];

const missing = requiredEnvVars.filter((varName) => !process.env[varName]);
if (missing.length > 0) {
  console.error('❌ Missing environment variables:', missing);
  console.error('\nPlease add these to your .env file:');
  console.error('  NEXT_PUBLIC_MAILER_API_URL=https://mailer.stackfordevs.com');
  console.error('  NEXT_PUBLIC_LLM_API_URL=https://llm.stackfordevs.com');
  console.error('  NEXT_PUBLIC_CMS_API_URL=https://cms.stackfordevs.com');
  console.error('  NEXT_PUBLIC_BILLING_API_URL=https://billing.stackfordevs.com');
  console.error('\nOr download the latest .env file from https://admin.stackfordevs.com/guide\n');
  process.exit(1);
}

console.log('✅ All environment variables loaded');

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increased limit for CSV imports

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] ${req.method} ${req.path}`);
  if (Object.keys(req.query).length > 0) {
    console.log('  Query:', JSON.stringify(req.query));
  }
  if (req.body && Object.keys(req.body).length > 0) {
    // Log body but hide sensitive fields
    const safeBody = { ...req.body };
    if (safeBody.password) safeBody.password = '[REDACTED]';
    if (safeBody.email) safeBody.email = safeBody.email.replace(/(?<=.{2}).*(?=@)/, '***');
    console.log('  Body:', JSON.stringify(safeBody));
  }
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Helper to build headers for StackForDevs API
const getStackForDevsHeaders = (includeAuth: boolean = false, authToken?: string) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': process.env.NEXT_PUBLIC_API_KEY!,
    'x-secret-key': process.env.NEXT_PUBLIC_SECRET_API_KEY!,
    'x-tenant-id': process.env.NEXT_PUBLIC_TENANT_ID!,
    'x-project-id': process.env.NEXT_PUBLIC_PROJECT_ID!,
  };

  if (includeAuth && authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  return headers;
};

// Helper to determine provider type from model name
const getProviderType = (model: string): 'openai' | 'anthropic' => {
  const modelLower = model.toLowerCase();

  // OpenAI models (GPT, o1 series)
  if (modelLower.includes('gpt') || modelLower.includes('o1')) {
    return 'openai';
  }

  // Anthropic models (Claude)
  if (modelLower.includes('claude') || modelLower.includes('sonnet') || modelLower.includes('haiku') || modelLower.includes('opus')) {
    return 'anthropic';
  }

  // Unknown model - throw error instead of defaulting
  throw new Error(`Unknown model provider for model: ${model}. Please use a GPT or Claude model.`);
};

// Enhanced error handler with detailed logging
const handleProxyError = async (
  error: any,
  endpointName: string,
  upstreamUrl: string,
  upstreamResponse?: Response,
  res?: express.Response
) => {
  console.error(`\n❌ ERROR in ${endpointName}:`);
  console.error('  Upstream URL:', upstreamUrl);

  // Log the error details
  if (error instanceof Error) {
    console.error('  Error Type:', error.name);
    console.error('  Error Message:', error.message);
    if (error.stack) {
      console.error('  Stack Trace:', error.stack.split('\n').slice(0, 3).join('\n'));
    }
  } else {
    console.error('  Raw Error:', error);
  }

  // If we have an upstream response, log its details
  if (upstreamResponse) {
    console.error('  Upstream Status:', upstreamResponse.status, upstreamResponse.statusText);
    try {
      const responseText = await upstreamResponse.text();
      console.error('  Upstream Response:', responseText.substring(0, 500));

      // Try to parse as JSON for structured error
      try {
        const jsonData = JSON.parse(responseText);
        if (res && !res.headersSent) {
          return res.status(upstreamResponse.status).json({
            error: jsonData.error || jsonData.message || 'Request failed',
            details: jsonData,
            _debug: {
              endpoint: endpointName,
              upstreamStatus: upstreamResponse.status,
              timestamp: new Date().toISOString()
            }
          });
        }
      } catch (parseError) {
        // Not JSON, return text
        if (res && !res.headersSent) {
          return res.status(upstreamResponse.status).json({
            error: responseText || 'Request failed',
            _debug: {
              endpoint: endpointName,
              upstreamStatus: upstreamResponse.status,
              timestamp: new Date().toISOString()
            }
          });
        }
      }
    } catch (readError) {
      console.error('  Failed to read upstream response:', readError);
    }
  }

  // Check for common network errors
  if (error.code === 'ECONNREFUSED') {
    console.error('  💡 TIP: The upstream service is not reachable. Check if it\'s running.');
  } else if (error.code === 'ETIMEDOUT') {
    console.error('  💡 TIP: The request timed out. The upstream service might be slow or down.');
  } else if (error.code === 'ENOTFOUND') {
    console.error('  💡 TIP: DNS resolution failed. Check the URL in your .env file.');
  }

  // Return error to client if response object is available
  if (res && !res.headersSent) {
    return res.status(500).json({
      error: `${endpointName} failed`,
      message: error.message || 'An unexpected error occurred',
      code: error.code,
      _debug: {
        endpoint: endpointName,
        upstreamUrl,
        errorType: error.name,
        timestamp: new Date().toISOString()
      }
    });
  }
};

// Auth endpoints
app.post('/api/auth/register', async (req, res) => {
  const upstreamUrl = `${process.env.NEXT_PUBLIC_AUTH_API_URL}/v1/register`;
  let response: Response | undefined;

  try {
    console.log('  → Calling:', upstreamUrl);
    response = await fetch(upstreamUrl, {
      method: 'POST',
      headers: getStackForDevsHeaders(),
      body: JSON.stringify(req.body),
    });

    console.log('  ← Response:', response.status, response.statusText);

    if (!response.ok) {
      return await handleProxyError(
        new Error(`Upstream returned ${response.status}`),
        'Register',
        upstreamUrl,
        response,
        res
      );
    }

    const data = await response.json();
    console.log('  ✓ Success');
    res.json(data);
  } catch (error) {
    return await handleProxyError(error, 'Register', upstreamUrl, response, res);
  }
});

app.post('/api/auth/login', async (req, res) => {
  const upstreamUrl = `${process.env.NEXT_PUBLIC_AUTH_API_URL}/v1/login`;
  let response: Response | undefined;

  try {
    console.log('  → Calling:', upstreamUrl);
    response = await fetch(upstreamUrl, {
      method: 'POST',
      headers: getStackForDevsHeaders(),
      body: JSON.stringify(req.body),
    });

    console.log('  ← Response:', response.status, response.statusText);

    if (!response.ok) {
      return await handleProxyError(
        new Error(`Upstream returned ${response.status}`),
        'Login',
        upstreamUrl,
        response,
        res
      );
    }

    const data = await response.json();
    console.log('  ✓ Success');
    res.json(data);
  } catch (error) {
    return await handleProxyError(error, 'Login', upstreamUrl, response, res);
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const response = await fetch(`${process.env.NEXT_PUBLIC_AUTH_API_URL}/v1/logout`, {
      method: 'POST',
      headers: getStackForDevsHeaders(),
      body: JSON.stringify(req.body),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

app.post('/api/auth/refresh', async (req, res) => {
  const upstreamUrl = `${process.env.NEXT_PUBLIC_AUTH_API_URL}/v1/refresh`;
  let response: Response | undefined;

  try {
    console.log('  → Calling:', upstreamUrl);
    response = await fetch(upstreamUrl, {
      method: 'POST',
      headers: getStackForDevsHeaders(),
      body: JSON.stringify(req.body),
    });

    console.log('  ← Response:', response.status, response.statusText);

    if (!response.ok) {
      return await handleProxyError(
        new Error(`Upstream returned ${response.status}`),
        'Refresh Token',
        upstreamUrl,
        response,
        res
      );
    }

    const data = await response.json();
    console.log('  ✓ Success');
    res.json(data);
  } catch (error) {
    return await handleProxyError(error, 'Refresh Token', upstreamUrl, response, res);
  }
});

app.get('/api/auth/me', async (req, res) => {
  const upstreamUrl = `${process.env.NEXT_PUBLIC_AUTH_API_URL}/v1/me`;
  let response: Response | undefined;

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    console.log('  → Calling:', upstreamUrl);

    response = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('  ← Response:', response.status, response.statusText);

    if (!response.ok) {
      return await handleProxyError(
        new Error(`Upstream returned ${response.status}`),
        'Auth Me',
        upstreamUrl,
        response,
        res
      );
    }

    const data = await response.json();
    console.log('  ✓ Success');
    res.json(data);
  } catch (error) {
    return await handleProxyError(error, 'Auth Me', upstreamUrl, response, res);
  }
});

// Notifications endpoints
app.get('/api/notifications', async (req, res) => {
  try {
    const authToken = req.headers.authorization?.replace('Bearer ', '');
    const userId = req.query.userId as string;

    const response = await fetch(
      `${process.env.NEXT_PUBLIC_NOTIFICATIONS_API_URL}/v1/notifications?userId=${userId}`,
      {
        method: 'GET',
        headers: getStackForDevsHeaders(true, authToken),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error('List notifications error:', error);
    res.status(500).json({ error: 'Failed to list notifications' });
  }
});

app.post('/api/notifications', async (req, res) => {
  try {
    const authToken = req.headers.authorization?.replace('Bearer ', '');

    const response = await fetch(`${process.env.NEXT_PUBLIC_NOTIFICATIONS_API_URL}/v1/notifications`, {
      method: 'POST',
      headers: getStackForDevsHeaders(true, authToken),
      body: JSON.stringify(req.body),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({ error: 'Failed to create notification' });
  }
});

app.patch('/api/notifications/:id/read', async (req, res) => {
  try {
    const authToken = req.headers.authorization?.replace('Bearer ', '');
    const { id } = req.params;

    const response = await fetch(
      `${process.env.NEXT_PUBLIC_NOTIFICATIONS_API_URL}/v1/notifications/${id}/read`,
      {
        method: 'PATCH',
        headers: getStackForDevsHeaders(true, authToken),
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error('Mark as read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

app.delete('/api/notifications/:id', async (req, res) => {
  try {
    const authToken = req.headers.authorization?.replace('Bearer ', '');
    const { id } = req.params;

    const response = await fetch(`${process.env.NEXT_PUBLIC_NOTIFICATIONS_API_URL}/v1/notifications/${id}`, {
      method: 'DELETE',
      headers: getStackForDevsHeaders(true, authToken),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return res.status(response.status).json(data);
    }

    res.json(data);
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// Mailer endpoints
app.post('/api/mailer/send', async (req, res) => {
  const upstreamUrl = `${process.env.NEXT_PUBLIC_MAILER_API_URL}/v1/emails/send`;
  let response: Response | undefined;

  try {
    const authToken = req.headers.authorization?.replace('Bearer ', '');
    console.log('  → Calling:', upstreamUrl);

    // Transform request to match mailer service format
    const mailerRequest = {
      tenantId: process.env.NEXT_PUBLIC_TENANT_ID,
      projectId: process.env.NEXT_PUBLIC_PROJECT_ID,
      recipientEmail: req.body.to,
      subject: req.body.subject,
      htmlBody: `<p>${req.body.body}</p>`,
      textBody: req.body.body,
      sendImmediately: true,
    };

    console.log('  → Mailer request:', JSON.stringify(mailerRequest, null, 2));

    response = await fetch(upstreamUrl, {
      method: 'POST',
      headers: getStackForDevsHeaders(true, authToken),
      body: JSON.stringify(mailerRequest),
    });

    console.log('  ← Response:', response.status, response.statusText);

    if (!response.ok) {
      return await handleProxyError(
        new Error(`Upstream returned ${response.status}`),
        'Send Email',
        upstreamUrl,
        response,
        res
      );
    }

    const data = await response.json();
    console.log('  ✓ Success');
    res.json(data);
  } catch (error) {
    return await handleProxyError(error, 'Send Email', upstreamUrl, response, res);
  }
});

// LLM endpoints
app.post('/api/llm/completion', async (req, res) => {
  const upstreamUrl = `${process.env.NEXT_PUBLIC_LLM_API_URL}/v1/completions`;
  let response: Response | undefined;

  try {
    const authToken = req.headers.authorization?.replace('Bearer ', '');
    console.log('  → Calling:', upstreamUrl);
    console.log('  → Auth:', authToken ? 'Present' : 'Missing');

    // Transform the request to match the LLM service format
    const { prompt, model, maxTokens, temperature } = req.body;

    // Detect provider type (throws error if unknown)
    let providerType: 'openai' | 'anthropic';
    try {
      providerType = getProviderType(model);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Invalid model';
      console.error('  ✗ Provider detection error:', errorMessage);
      return res.status(400).json({ error: errorMessage });
    }

    const llmRequest = {
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      model,
      providerType,
      maxTokens,
      temperature,
      complexityScore: 50, // Default complexity score
    };

    console.log('  → Provider:', providerType, 'Model:', model);

    response = await fetch(upstreamUrl, {
      method: 'POST',
      headers: getStackForDevsHeaders(true, authToken),
      body: JSON.stringify(llmRequest),
    });

    console.log('  ← Response:', response.status, response.statusText);

    if (!response.ok) {
      return await handleProxyError(
        new Error(`Upstream returned ${response.status}`),
        'LLM Completion',
        upstreamUrl,
        response,
        res
      );
    }

    const data = await response.json() as any;
    console.log('  ✓ Success');

    // Transform response to match what the frontend expects
    res.json({
      completion: data.content,
      model: data.model,
      usage: data.usage,
    });
  } catch (error) {
    return await handleProxyError(error, 'LLM Completion', upstreamUrl, response, res);
  }
});

app.post('/api/llm/batch', async (req, res) => {
  const upstreamUrl = `${process.env.NEXT_PUBLIC_LLM_API_URL}/v1/batch`;
  let response: Response | undefined;

  try {
    const authToken = req.headers.authorization?.replace('Bearer ', '');
    console.log('  → Calling:', upstreamUrl);
    console.log('  → Auth:', authToken ? 'Present' : 'Missing');

    // Transform the request to match the LLM service batch format
    const { prompt, model, maxTokens, temperature } = req.body;

    // Detect provider type (throws error if unknown)
    let providerType: 'openai' | 'anthropic';
    try {
      providerType = getProviderType(model);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Invalid model';
      console.error('  ✗ Provider detection error:', errorMessage);
      return res.status(400).json({ error: errorMessage });
    }

    // Batch API requires a "requests" array with customId and body
    const llmRequest = {
      providerType,
      requests: [
        {
          customId: 'batch-request-1',
          body: {
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
            model,
            maxTokens,
            // Note: OpenAI GPT-5 models don't support temperature, but Anthropic does
            ...(providerType === 'anthropic' && temperature !== undefined ? { temperature } : {})
          }
        }
      ]
    };

    console.log('  → Provider:', providerType, 'Model:', model);

    response = await fetch(upstreamUrl, {
      method: 'POST',
      headers: getStackForDevsHeaders(true, authToken),
      body: JSON.stringify(llmRequest),
    });

    console.log('  ← Response:', response.status, response.statusText);

    if (!response.ok) {
      return await handleProxyError(
        new Error(`Upstream returned ${response.status}`),
        'LLM Batch',
        upstreamUrl,
        response,
        res
      );
    }

    const data = await response.json() as any;
    console.log('  ✓ Success');

    // Return batch job ID and status
    res.json({
      batchJobId: data.batchJobId,
      status: data.status,
    });
  } catch (error) {
    return await handleProxyError(error, 'LLM Batch', upstreamUrl, response, res);
  }
});

app.get('/api/llm/batch/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const upstreamUrl = `${process.env.NEXT_PUBLIC_LLM_API_URL}/v1/batch/${jobId}`;
  let response: Response | undefined;

  try {
    const authToken = req.headers.authorization?.replace('Bearer ', '');
    console.log('  → Calling:', upstreamUrl);
    console.log('  → Auth:', authToken ? 'Present' : 'Missing');

    response = await fetch(upstreamUrl, {
      method: 'GET',
      headers: getStackForDevsHeaders(true, authToken),
    });

    console.log('  ← Response:', response.status, response.statusText);

    if (!response.ok) {
      return await handleProxyError(
        new Error(`Upstream returned ${response.status}`),
        'LLM Batch Status',
        upstreamUrl,
        response,
        res
      );
    }

    const data = await response.json() as any;
    console.log('  ✓ Success - Status:', data.status);

    // If batch is completed, fetch the results
    let result = null;
    let error = null;

    if (data.status === 'completed') {
      try {
        const resultsUrl = `${process.env.NEXT_PUBLIC_LLM_API_URL}/v1/batch/${jobId}/results`;
        console.log('  → Fetching results:', resultsUrl);

        const resultsResponse = await fetch(resultsUrl, {
          method: 'GET',
          headers: getStackForDevsHeaders(true, authToken),
        });

        if (resultsResponse.ok) {
          const resultsData = await resultsResponse.json() as any;
          console.log('  ✓ Results fetched:', resultsData.resultCount, 'results');

          // Extract the completion from the first result
          if (resultsData.results && resultsData.results.length > 0) {
            const firstResult = resultsData.results[0];
            console.log('  → First result structure:', JSON.stringify(firstResult, null, 2));

            // Try OpenAI format first (response.body.choices[0].message.content)
            if (firstResult.response?.body?.choices?.[0]?.message?.content) {
              result = firstResult.response.body.choices[0].message.content;
              console.log('  ✓ Extracted OpenAI format result');
            }
            // Try Anthropic format (result.message.content[0].text)
            else if (firstResult.result?.message?.content?.[0]?.text) {
              result = firstResult.result.message.content[0].text;
              console.log('  ✓ Extracted Anthropic format result');
            }
            // Fallback: try to find any text content
            else {
              console.log('  ✗ Could not extract result from known formats');
              result = 'Batch completed but result format is unexpected. Check the LLM Logs for details.';
            }
          } else {
            console.log('  ✗ No results found in response');
            result = 'Batch completed but no results were returned.';
          }
        } else {
          console.log('  ✗ Failed to fetch results, status:', resultsResponse.status);
          // Try to get error details
          const errorText = await resultsResponse.text().catch(() => 'No error details available');
          console.log('  ✗ Error details:', errorText);
          result = 'Batch processing completed successfully, but there was an issue retrieving the results. This is a known issue with Anthropic batch results. Please check the LLM Logs in the Admin Dashboard to view your batch results, or try using real-time completion instead of batch processing.';
        }
      } catch (resultsError) {
        console.error('  ✗ Failed to fetch results:', resultsError);
        result = 'Batch processing completed successfully, but there was an issue retrieving the results. Please check the LLM Logs in the Admin Dashboard to view your batch results.';
      }
    } else if (data.status === 'failed' || data.status === 'expired' || data.status === 'cancelled') {
      error = data.errorMessage || `Batch ${data.status}`;
    }

    // Return batch status and result
    res.json({
      status: data.status,
      result: result,
      error: error,
    });
  } catch (error) {
    return await handleProxyError(error, 'LLM Batch Status', upstreamUrl, response, res);
  }
});

// CMS endpoints
app.post('/api/cms/content', async (req, res) => {
  const upstreamUrl = `${process.env.NEXT_PUBLIC_CMS_API_URL}/v1/content`;
  let response: Response | undefined;

  try {
    console.log('📝 POST /api/cms/content');
    console.log('  → Calling:', upstreamUrl);

    response = await fetch(upstreamUrl, {
      method: 'POST',
      headers: getStackForDevsHeaders(false),
      body: JSON.stringify(req.body),
    });

    console.log('  ← Response:', response.status, response.statusText);

    if (!response.ok) {
      return await handleProxyError(
        new Error(`Upstream returned ${response.status}`),
        'Create Content',
        upstreamUrl,
        response,
        res
      );
    }

    const data = await response.json();
    console.log('  ✓ Success');
    res.status(201).json(data);
  } catch (error) {
    return await handleProxyError(error, 'Create Content', upstreamUrl, response, res);
  }
});

app.get('/api/cms/content', async (req, res) => {
  const queryString = new URLSearchParams(req.query as any).toString();
  const upstreamUrl = `${process.env.NEXT_PUBLIC_CMS_API_URL}/v1/content${queryString ? '?' + queryString : ''}`;
  let response: Response | undefined;

  try {
    console.log('📋 GET /api/cms/content');
    console.log('  → Calling:', upstreamUrl);

    response = await fetch(upstreamUrl, {
      method: 'GET',
      headers: getStackForDevsHeaders(false),
    });

    console.log('  ← Response:', response.status, response.statusText);

    if (!response.ok) {
      return await handleProxyError(
        new Error(`Upstream returned ${response.status}`),
        'List Content',
        upstreamUrl,
        response,
        res
      );
    }

    const data = await response.json() as any;
    console.log('  ✓ Success - Returned', data.content?.length || 0, 'items');
    res.json(data);
  } catch (error) {
    return await handleProxyError(error, 'List Content', upstreamUrl, response, res);
  }
});

app.get('/api/cms/content/:id', async (req, res) => {
  const { id } = req.params;
  const upstreamUrl = `${process.env.NEXT_PUBLIC_CMS_API_URL}/v1/content/${id}`;
  let response: Response | undefined;

  try {
    console.log('📄 GET /api/cms/content/:id');
    console.log('  → Calling:', upstreamUrl);

    response = await fetch(upstreamUrl, {
      method: 'GET',
      headers: getStackForDevsHeaders(false),
    });

    console.log('  ← Response:', response.status, response.statusText);

    if (!response.ok) {
      return await handleProxyError(
        new Error(`Upstream returned ${response.status}`),
        'Get Content',
        upstreamUrl,
        response,
        res
      );
    }

    const data = await response.json();
    console.log('  ✓ Success');
    res.json(data);
  } catch (error) {
    return await handleProxyError(error, 'Get Content', upstreamUrl, response, res);
  }
});

app.put('/api/cms/content/:id', async (req, res) => {
  const { id } = req.params;
  const upstreamUrl = `${process.env.NEXT_PUBLIC_CMS_API_URL}/v1/content/${id}`;
  let response: Response | undefined;

  try {
    console.log('✏️ PUT /api/cms/content/:id');
    console.log('  → Calling:', upstreamUrl);

    response = await fetch(upstreamUrl, {
      method: 'PUT',
      headers: getStackForDevsHeaders(false),
      body: JSON.stringify(req.body),
    });

    console.log('  ← Response:', response.status, response.statusText);

    if (!response.ok) {
      return await handleProxyError(
        new Error(`Upstream returned ${response.status}`),
        'Update Content',
        upstreamUrl,
        response,
        res
      );
    }

    const data = await response.json();
    console.log('  ✓ Success');
    res.json(data);
  } catch (error) {
    return await handleProxyError(error, 'Update Content', upstreamUrl, response, res);
  }
});

app.delete('/api/cms/content/:id', async (req, res) => {
  const { id } = req.params;
  const upstreamUrl = `${process.env.NEXT_PUBLIC_CMS_API_URL}/v1/content/${id}`;
  let response: Response | undefined;

  try {
    console.log('🗑️ DELETE /api/cms/content/:id');
    console.log('  → Calling:', upstreamUrl);

    response = await fetch(upstreamUrl, {
      method: 'DELETE',
      headers: getStackForDevsHeaders(false),
    });

    console.log('  ← Response:', response.status, response.statusText);

    if (!response.ok) {
      return await handleProxyError(
        new Error(`Upstream returned ${response.status}`),
        'Delete Content',
        upstreamUrl,
        response,
        res
      );
    }

    console.log('  ✓ Success');
    res.status(204).send();
  } catch (error) {
    return await handleProxyError(error, 'Delete Content', upstreamUrl, response, res);
  }
});

// Billing endpoints
app.get('/api/billing/subscription', async (req, res) => {
  const customerEmail = req.query.customerEmail as string;
  const environment = (req.query.environment as string) || 'test';

  if (!customerEmail) {
    return res.status(400).json({ error: 'customerEmail query parameter is required' });
  }

  const upstreamUrl = `${process.env.NEXT_PUBLIC_BILLING_API_URL}/v1/customer/subscription?customerEmail=${encodeURIComponent(customerEmail)}&environment=${environment}`;
  let response: Response | undefined;

  try {
    console.log('💰 GET /api/billing/subscription');
    console.log('  → Calling:', upstreamUrl);

    response = await fetch(upstreamUrl, {
      method: 'GET',
      headers: getStackForDevsHeaders(false),
    });

    console.log('  ← Response:', response.status, response.statusText);

    if (!response.ok) {
      return await handleProxyError(
        new Error(`Upstream returned ${response.status}`),
        'Get Subscription',
        upstreamUrl,
        response,
        res
      );
    }

    const data = await response.json();
    console.log('  ✓ Success');
    res.json(data);
  } catch (error) {
    return await handleProxyError(error, 'Get Subscription', upstreamUrl, response, res);
  }
});

app.get('/api/billing/plans', async (req, res) => {
  const environment = (req.query.environment as string) || 'test';
  const upstreamUrl = `${process.env.NEXT_PUBLIC_BILLING_API_URL}/v1/stripe/prices?type=recurring&active=true&environment=${environment}`;
  let response: Response | undefined;

  try {
    console.log('📋 GET /api/billing/plans');
    console.log('  → Calling:', upstreamUrl);

    response = await fetch(upstreamUrl, {
      method: 'GET',
      headers: getStackForDevsHeaders(false),
    });

    console.log('  ← Response:', response.status, response.statusText);

    if (!response.ok) {
      return await handleProxyError(
        new Error(`Upstream returned ${response.status}`),
        'Get Plans',
        upstreamUrl,
        response,
        res
      );
    }

    const data = await response.json() as any;
    console.log('  ✓ Success - Returned', data.prices?.length || 0, 'prices');

    // Debug: Log first price to see structure
    if (data.prices && data.prices.length > 0) {
      console.log('  → Sample price structure:', JSON.stringify(data.prices[0], null, 2));
    }

    // Transform Stripe prices to plan format expected by frontend
    const plans = (data.prices || []).map((price: any) => {
      console.log('  → Processing price:', price.id, 'nickname:', price.nickname, 'product:', typeof price.product);

      return {
        id: price.id,
        name: price.nickname || price.product?.name || price.metadata?.name || 'Unnamed Plan',
        amount: price.unit_amount || 0,
        currency: price.currency || 'usd',
        interval: price.recurring?.interval || 'month',
        features: price.product?.metadata?.features ?
          JSON.parse(price.product.metadata.features) :
          (price.metadata?.features ? JSON.parse(price.metadata.features) : []),
        limits: price.product?.metadata?.limits ?
          JSON.parse(price.product.metadata.limits) :
          (price.metadata?.limits ? JSON.parse(price.metadata.limits) : {}),
      };
    });

    res.json({ plans });
  } catch (error) {
    return await handleProxyError(error, 'Get Plans', upstreamUrl, response, res);
  }
});

app.post('/api/billing/checkout-session', async (req, res) => {
  const environment = (req.query.environment as string) || 'test';
  const upstreamUrl = `${process.env.NEXT_PUBLIC_BILLING_API_URL}/v1/stripe/checkout/session?environment=${environment}`;
  let response: Response | undefined;

  try {
    const authToken = req.headers.authorization?.replace('Bearer ', '');

    console.log('🛒 POST /api/billing/checkout-session');
    console.log('  → Calling:', upstreamUrl);
    console.log('  → Original Body:', JSON.stringify(req.body, null, 2));

    // Transform frontend request to Stripe checkout format
    const checkoutRequest = {
      line_items: [
        {
          price: req.body.planId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: req.body.successUrl,
      cancel_url: req.body.cancelUrl,
      customer_email: req.body.customerEmail,
    };

    console.log('  → Transformed Body:', JSON.stringify(checkoutRequest, null, 2));

    response = await fetch(upstreamUrl, {
      method: 'POST',
      headers: getStackForDevsHeaders(true, authToken),
      body: JSON.stringify(checkoutRequest),
    });

    console.log('  ← Response:', response.status, response.statusText);

    if (!response.ok) {
      return await handleProxyError(
        new Error(`Upstream returned ${response.status}`),
        'Create Checkout Session',
        upstreamUrl,
        response,
        res
      );
    }

    const data = await response.json() as any;
    console.log('  ✓ Success - Session ID:', data.session?.id);

    // Transform response to match frontend expectations
    res.json({
      sessionId: data.session?.id,
      url: data.session?.url,
    });
  } catch (error) {
    return await handleProxyError(error, 'Create Checkout Session', upstreamUrl, response, res);
  }
});

app.post('/api/billing/customer-portal', async (req, res) => {
  const environment = (req.query.environment as string) || 'test';
  const upstreamUrl = `${process.env.NEXT_PUBLIC_BILLING_API_URL}/v1/stripe/customer-portal/session?environment=${environment}`;
  let response: Response | undefined;

  try {
    const authToken = req.headers.authorization?.replace('Bearer ', '');

    console.log('🏪 POST /api/billing/customer-portal');
    console.log('  → Calling:', upstreamUrl);

    // Transform request to customer portal format
    const portalRequest = {
      customer_email: req.body.customerEmail,
      return_url: req.body.returnUrl || `${req.headers.origin || 'http://localhost:3000'}/dashboard`,
    };

    console.log('  → Portal Request:', JSON.stringify(portalRequest, null, 2));

    response = await fetch(upstreamUrl, {
      method: 'POST',
      headers: getStackForDevsHeaders(true, authToken),
      body: JSON.stringify(portalRequest),
    });

    console.log('  ← Response:', response.status, response.statusText);

    if (!response.ok) {
      return await handleProxyError(
        new Error(`Upstream returned ${response.status}`),
        'Create Customer Portal Session',
        upstreamUrl,
        response,
        res
      );
    }

    const data = await response.json() as any;
    console.log('  ✓ Success - Portal URL:', data.session?.url);

    // Transform response to match frontend expectations
    res.json({
      url: data.session?.url,
    });
  } catch (error) {
    return await handleProxyError(error, 'Create Customer Portal Session', upstreamUrl, response, res);
  }
});

// PayForeman AI routes
app.use('/api/auth', authRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/deadlines', deadlineRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/notifications', notificationRoutes);

// Global error handler (must be last)
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('\n❌ UNHANDLED ERROR:');
  console.error('  Path:', req.method, req.path);
  console.error('  Error:', err);
  console.error('  Stack:', err.stack);

  if (!res.headersSent) {
    res.status(500).json({
      error: 'Internal server error',
      message: err.message,
      _debug: {
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
      }
    });
  }
});

// Run database migrations
async function runMigrations() {
  try {
    console.log('🔄 Running database migrations...');
    const { query } = await import('./utils/database');
    const migrationPath = path.join(__dirname, '../migrations/001_create_payforeman_tables.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    await query(migrationSQL);
    console.log('✅ Database migrations completed successfully');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

// Start server with optional database initialization
(async () => {
  try {
    // Test database connection (but don't fail if it's not available)
    const dbConnected = await testConnection();

    if (dbConnected) {
      // Run migrations if database is available
      await runMigrations();
      console.log('✅ Database initialized successfully');
    } else {
      console.warn('⚠️  Database not available - starting without database');
      console.warn('   Auth endpoints will work via StackForDevs API');
      console.warn('   Database-dependent features (invoices, deadlines, projects) will be unavailable');
      console.warn('   To enable full functionality, install and start PostgreSQL');
    }

    // Start listening regardless of database status
    app.listen(PORT, () => {
      console.log(`🚀 API server running on http://localhost:${PORT}`);
      console.log(`📡 Proxying to:`);
      console.log(`   Auth: ${process.env.NEXT_PUBLIC_AUTH_API_URL}`);
      console.log(`   Notifications: ${process.env.NEXT_PUBLIC_NOTIFICATIONS_API_URL}`);
      console.log(`   Mailer: ${process.env.NEXT_PUBLIC_MAILER_API_URL}`);
      console.log(`   LLM: ${process.env.NEXT_PUBLIC_LLM_API_URL}`);
      console.log(`   CMS: ${process.env.NEXT_PUBLIC_CMS_API_URL}`);
      console.log(`   Billing: ${process.env.NEXT_PUBLIC_BILLING_API_URL}`);
      console.log(`\n💡 Debug logging enabled - check console for detailed error information`);
      console.log(`🗄️  Database: ${dbConnected ? 'Connected' : 'Not Available (auth still works)'}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
})();
