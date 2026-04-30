import { Router } from 'express';
import { requireAuth, loadUser } from '../middleware/auth.js';
import { getAiModel, getOpenAiClient, isAiConfigured } from '../lib/ai.js';

const router = Router();

router.use(requireAuth);
router.use(loadUser);

router.get('/health', async (req, res, next) => {
  try {
    const configured = isAiConfigured();
    if (!configured) {
      return res.status(503).json({
        ok: false,
        configured: false,
        error: 'OPENAI_API_KEY is not set',
      });
    }
    const client = getOpenAiClient();
    // Lightweight connectivity check.
    await client.models.list({ limit: 1 });
    return res.json({
      ok: true,
      configured: true,
      model: getAiModel(),
    });
  } catch (err) {
    return res.status(502).json({
      ok: false,
      configured: isAiConfigured(),
      error: err?.message || 'AI health check failed',
    });
  }
});

router.post('/chat', async (req, res, next) => {
  try {
    if (!isAiConfigured()) {
      return res.status(503).json({ error: 'OPENAI_API_KEY is not set' });
    }
    const body = req.body || {};
    const prompt = String(body.prompt || '').trim();
    if (!prompt) {
      return res.status(400).json({ error: 'prompt is required' });
    }

    const model = String(body.model || '').trim() || getAiModel();
    const client = getOpenAiClient();
    const response = await client.responses.create({
      model,
      input: [
        {
          role: 'system',
          content: 'You are a helpful assistant for Wise App users. Be concise and practical.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_output_tokens: 700,
    });

    const text =
      typeof response.output_text === 'string' && response.output_text.trim()
        ? response.output_text
        : '';

    return res.json({
      ok: true,
      model,
      reply: text,
      usage: response.usage || null,
    });
  } catch (err) {
    next(err);
  }
});

export default router;

