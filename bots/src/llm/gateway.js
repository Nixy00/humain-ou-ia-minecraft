// Client de la passerelle LiteLLM (endpoint /v1/chat/completions, compatible OpenAI).
// La passerelle est partagée entre tous les groupes : on limite le débit,
// on coupe les requêtes trop longues et on réessaie seulement les erreurs temporaires.

class GatewayError extends Error {
  constructor(message, { status = null, body = null, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.body = body;
    this.retryable = retryable;
  }
}

// File d'attente : au plus `maxConcurrent` requêtes en même temps,
// et au moins `minIntervalMs` entre deux départs.
class RateLimiter {
  constructor(maxConcurrent, minIntervalMs) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
    this.minIntervalMs = minIntervalMs;
    this.active = 0;
    this.lastStart = 0;
    this.queue = [];
  }

  run(fn) {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
      this._next();
    });
  }

  _next() {
    if (this.active >= this.maxConcurrent || this.queue.length === 0 || this._timer) return;
    const wait = this.lastStart + this.minIntervalMs - Date.now();
    if (wait > 0) {
      this._timer = setTimeout(() => { this._timer = null; this._next(); }, wait);
      return;
    }
    const { fn, resolve, reject } = this.queue.shift();
    this.active++;
    this.lastStart = Date.now();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => { this.active--; this._next(); });
    this._next();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Gateway {
  constructor(cfg, { fetchImpl = globalThis.fetch } = {}) {
    if (!cfg.model) throw new Error('LLM_MODEL est vide : renseigner le nom du modèle exposé par LiteLLM dans .env');
    this.cfg = cfg;
    this.fetch = fetchImpl;
    this.limiter = new RateLimiter(cfg.maxConcurrent, cfg.minIntervalMs);
    this.tokensUtilises = 0;
  }

  // Envoie une requête et renvoie la réponse + les mesures (latence, jetons, coût).
  // `metadata` est transmis à LiteLLM, qui le relaie à Langfuse s'il est configuré.
  async chat(body, metadata = {}) {
    if (this.cfg.budgetTokens && this.tokensUtilises >= this.cfg.budgetTokens) {
      throw new GatewayError(`limite de ${this.cfg.budgetTokens} tokens atteinte (LLM_BUDGET_TOKENS)`);
    }
    const payload = {
      model: this.cfg.model,
      temperature: this.cfg.temperature,
      max_tokens: this.cfg.maxTokens,
      ...body,
      metadata,
    };
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        const res = await this.limiter.run(() => this._once(payload));
        this.tokensUtilises += (res.usage && res.usage.total_tokens) || 0;
        return { ...res, attempts: attempt };
      } catch (err) {
        if (!(err instanceof GatewayError) || !err.retryable || attempt > this.cfg.maxRetries) {
          err.attempts = attempt;
          throw err;
        }
        // Backoff exponentiel avec aléa, ou délai imposé par la passerelle (429).
        const backoff = err.retryAfterMs ?? Math.min(30000, 1000 * 2 ** (attempt - 1)) * (0.5 + Math.random());
        await sleep(backoff);
      }
    }
  }

  async _once(payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    const t0 = Date.now();
    let res;
    try {
      res = await this.fetch(`${this.cfg.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      const timeout = err.name === 'AbortError';
      throw new GatewayError(timeout ? `délai dépassé (${this.cfg.timeoutMs} ms)` : `réseau : ${err.message}`, { retryable: true });
    } finally {
      clearTimeout(timer);
    }
    const latencyMs = Date.now() - t0;
    const text = await res.text();

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      const e = new GatewayError(`HTTP ${res.status}`, { status: res.status, body: text.slice(0, 2000), retryable });
      const ra = parseFloat(res.headers.get('retry-after'));
      if (Number.isFinite(ra)) e.retryAfterMs = ra * 1000;
      throw e;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new GatewayError('réponse non JSON', { status: res.status, body: text.slice(0, 2000), retryable: true });
    }
    const cost = parseFloat(res.headers.get('x-litellm-response-cost'));
    return {
      message: data.choices?.[0]?.message ?? {},
      finishReason: data.choices?.[0]?.finish_reason ?? null,
      usage: data.usage ?? null,
      latencyMs,
      costUsd: Number.isFinite(cost) ? cost : null,
      litellmCallId: res.headers.get('x-litellm-call-id'),
      responseId: data.id ?? null,
    };
  }
}

module.exports = { Gateway, GatewayError, RateLimiter };
