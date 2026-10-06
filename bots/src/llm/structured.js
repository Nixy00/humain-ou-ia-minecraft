// Demande au modele de choisir un outil et verifie sa reponse.
// Si le format est faux on redemande, si le function calling ne marche pas on passe en mode JSON.

const { randomUUID } = require('crypto');
const { validate } = require('./schema');

// Retire le raisonnement (<think>...</think>) et les blocs ``` puis extrait le premier objet JSON.
function extractJson(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Les longueurs de texte sont vérifiées par notre code (schema.js) après la réponse : inutile de les envoyer.
// On garde minimum et maximum des nombres : sans eux il demandait 20 objets et se faisait refuser.
const LIMITES = ['maxLength', 'minLength'];
function alleger(schema) {
  const copie = {};
  for (const [cle, val] of Object.entries(schema)) {
    if (LIMITES.includes(cle)) continue;
    if (cle === 'properties') copie[cle] = Object.fromEntries(Object.entries(val).map(([k, v]) => [k, alleger(v)]));
    else copie[cle] = val;
  }
  return copie;
}

function toOpenAiTools(tools) {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: alleger(t.parameters) },
  }));
}

function jsonModeInstructions(tools) {
  const list = tools
    .map((t) => `- ${t.name} : ${t.description}\n  arguments (JSON Schema) : ${JSON.stringify(t.parameters)}`)
    .join('\n');
  return (
    'Réponds UNIQUEMENT avec un objet JSON, sans texte autour, de la forme ' +
    '{"outil": "<nom>", "arguments": {...}}.\nOutils disponibles :\n' + list
  );
}

// Lit la réponse brute et renvoie { name, args } ou { error }.
function parseResponse(message, mode) {
  if (mode === 'tools') {
    const call = message.tool_calls?.[0];
    if (call?.function?.name) {
      let args = call.function.arguments ?? {};
      if (typeof args === 'string') {
        try {
          args = args.trim() === '' ? {} : JSON.parse(args);
        } catch {
          return { error: `les arguments de ${call.function.name} ne sont pas du JSON valide` };
        }
      }
      return { name: call.function.name, args };
    }
    // Certains analyseurs de vLLM laissent l'appel d'outil dans le texte.
    const obj = extractJson(message.content);
    if (obj && (obj.name || obj.outil)) return { name: obj.name ?? obj.outil, args: obj.arguments ?? obj.parameters ?? {} };
    return { error: "aucun outil n'a été appelé" };
  }
  const obj = extractJson(message.content);
  if (!obj) return { error: 'la réponse ne contient pas un objet JSON valide' };
  const name = obj.outil ?? obj.name;
  if (!name) return { error: 'le champ "outil" est manquant' };
  return { name, args: obj.arguments ?? {} };
}

function isToolsUnsupported(err) {
  return err.status === 400 && /tool|function/i.test(err.body ?? '');
}

async function callTool({ gateway, logger, messages, tools, meta, extraCheck, maxFormatRetries = 2 }) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  let convo = [...messages];
  const callIds = [];
  gateway.mode = gateway.mode ?? gateway.cfg.mode;

  for (let attempt = 1; attempt <= maxFormatRetries + 1; attempt++) {
    const mode = gateway.mode;
    const body =
      mode === 'tools'
        ? { messages: convo, tools: toOpenAiTools(tools), tool_choice: gateway.cfg.toolChoice }
        : { messages: [...convo, { role: 'system', content: jsonModeInstructions(tools) }] };
    const callId = randomUUID();
    callIds.push(callId);
    const record = {
      call_id: callId,
      agent: meta.agent,
      decision_id: meta.decisionId,
      kind: meta.kind,
      format_attempt: attempt,
      mode,
      model: gateway.cfg.model,
      request: { messages: body.messages, tools: tools.map((t) => t.name) },
    };

    let res;
    try {
      res = await gateway.chat(body, {
        session_id: logger.gameId,
        trace_id: meta.decisionId,
        trace_user_id: meta.agent,
        generation_name: `${meta.kind}#${attempt}`,
        tags: [meta.agent, meta.kind],
      });
    } catch (err) {
      logger.write('llm_calls', { ...record, ok: false, error: err.message, status: err.status ?? null, http_attempts: err.attempts ?? null, response_body: err.body ?? null });
      if (mode === 'tools' && isToolsUnsupported(err)) {
        gateway.mode = 'json';
        logger.write('errors', { agent: meta.agent, message: 'function calling refusé par le serveur : passage en mode JSON', detail: err.body });
        continue;
      }
      return null;
    }

    const parsed = parseResponse(res.message, mode);
    let errors = parsed.error ? [parsed.error] : [];
    if (!parsed.error) {
      const tool = byName.get(parsed.name);
      if (!tool) errors = [`l'outil "${parsed.name}" n'existe pas`];
      else errors = [...validate(tool.parameters, parsed.args), ...(extraCheck ? extraCheck(parsed.name, parsed.args) : [])];
    }

    logger.write('llm_calls', {
      ...record,
      ok: true,
      valid: errors.length === 0,
      errors,
      response: res.message,
      finish_reason: res.finishReason,
      usage: res.usage,
      latency_ms: res.latencyMs,
      cost_usd: res.costUsd,
      http_attempts: res.attempts,
      litellm_call_id: res.litellmCallId,
    });

    if (errors.length === 0) return { name: parsed.name, args: parsed.args, callIds };

    // Redemande en expliquant l'erreur au modèle.
    const previous = res.message.content || JSON.stringify(res.message.tool_calls ?? '');
    convo = [
      ...messages,
      { role: 'assistant', content: String(previous).slice(0, 2000) },
      {
        role: 'user',
        content: `Réponse invalide : ${errors.join(' ; ')}. Recommence en appelant exactement un outil parmi : ${[...byName.keys()].join(', ')}.`,
      },
    ];
  }
  return null;
}

module.exports = { callTool, extractJson, parseResponse, toOpenAiTools };
