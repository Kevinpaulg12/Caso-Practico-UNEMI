import api from './api';

/**
 * Envía un mensaje al asistente y recibe la respuesta mientras el modelo la escribe
 * (Server-Sent Events sobre fetch, porque EventSource no admite POST ni cabeceras).
 *
 * onDelta(texto) recibe el texto acumulado de la respuesta; la promesa se resuelve con el mismo
 * resultado que POST /assistant/messages/. Si algo falla, lanza un error y quien llama recurre a
 * la petición normal.
 */
export async function streamAssistantMessage(payload, onDelta) {
  const response = await fetch(`${api.defaults.baseURL}/assistant/messages/stream/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      Authorization: `Bearer ${localStorage.getItem('access_token')}`,
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok || !response.body) {
    throw Object.assign(new Error('La transmisión no está disponible'), { status: response.status });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end = buffer.indexOf('\n\n');
    while (end >= 0) {
      const [eventLine, dataLine] = buffer.slice(0, end).split('\n');
      buffer = buffer.slice(end + 2);
      const event = eventLine.replace('event: ', '');
      const data = JSON.parse(dataLine.replace('data: ', ''));
      if (event === 'delta') onDelta(data.text);
      else if (event === 'done') result = data;
      else if (event === 'error') throw new Error(data.detail);
      end = buffer.indexOf('\n\n');
    }
  }
  if (!result) throw new Error('La respuesta llegó incompleta');
  return result;
}
