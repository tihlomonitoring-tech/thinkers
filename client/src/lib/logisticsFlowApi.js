import { getApiBase } from './apiBase.js';

/** Shared logistics-flow API paths for Command Centre and Contractor. */
export function createLogisticsFlowApi(request, prefix) {
  const base = `/${prefix}/logistics-flow`;

  /**
   * Parse with SSE progress events: { type:'progress', percent, message, phase } then { type:'done', result }.
   */
  async function parseStream(body, { onProgress, signal } = {}) {
    const API = getApiBase();
    const res = await fetch(`${API}${base}/parse-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || res.statusText || 'Parse failed');
    }
    const reader = res.body?.getReader();
    if (!reader) {
      return request(`${base}/parse`, { method: 'POST', body: JSON.stringify(body) });
    }
    const decoder = new TextDecoder();
    let buffer = '';
    let finalResult = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        let evt;
        try {
          evt = JSON.parse(line.slice(6));
        } catch (_) {
          continue;
        }
        if (evt.type === 'progress') {
          onProgress?.({
            percent: evt.percent ?? 0,
            message: evt.message || '',
            phase: evt.phase || '',
          });
        } else if (evt.type === 'error') {
          throw new Error(evt.message || 'Parse failed');
        } else if (evt.type === 'done') {
          onProgress?.({ percent: 100, message: evt.message || 'Complete', phase: 'done' });
          finalResult = evt.result;
        }
      }
    }
    if (!finalResult) throw new Error('Parse ended without a result');
    return finalResult;
  }

  return {
    parse: (body) => request(`${base}/parse`, { method: 'POST', body: JSON.stringify(body) }),
    parseStream,
    enrichRows: (body) => request(`${base}/enrich-rows`, { method: 'POST', body: JSON.stringify(body) }),
    getActiveShift: () => request(`${base}/shifts/active`),
    listShifts: (status = 'completed') => request(`${base}/shifts?status=${encodeURIComponent(status)}`),
    getShift: (id) => request(`${base}/shifts/${encodeURIComponent(id)}`),
    createShift: (body) => request(`${base}/shifts`, { method: 'POST', body: JSON.stringify(body) }),
    addUpdate: (shiftId, body) =>
      request(`${base}/shifts/${encodeURIComponent(shiftId)}/updates`, { method: 'POST', body: JSON.stringify(body) }),
    saveConfirmations: (shiftId, confirmations) =>
      request(`${base}/shifts/${encodeURIComponent(shiftId)}/confirmations`, {
        method: 'PATCH',
        body: JSON.stringify({ confirmations }),
      }),
    completeShift: (shiftId) =>
      request(`${base}/shifts/${encodeURIComponent(shiftId)}/complete`, { method: 'POST', body: '{}' }),
    lookupTruck: (registration) =>
      request(`${base}/trucks/lookup?registration=${encodeURIComponent(registration)}`),
  };
}
