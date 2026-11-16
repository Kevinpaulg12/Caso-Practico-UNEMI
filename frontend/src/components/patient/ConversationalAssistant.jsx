import { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import { streamAssistantMessage } from '../../services/assistantStream';
import { AlertDot, SymptomChips } from '../AlertLevel';
import { ALERT_LABELS } from '../alertLevels';
import { IconSend, IconSparkles } from '../Icons';

// Atajos para describir síntomas que el sistema reconoce (RU01: registro guiado).
const SYMPTOM_SHORTCUTS = [
  ['Dolor', 'Tengo dolor'],
  ['Inflamación', 'Tengo inflamación'],
  ['Sangrado', 'Tengo sangrado'],
  ['Sensibilidad', 'Siento sensibilidad al frío'],
  ['Dolor al morder', 'Me duele al morder'],
  ['Llaga', 'Tengo una llaga'],
  ['Aparato suelto', 'Se me despegó un bracket'],
  ['Fiebre', 'Tengo fiebre'],
];
const COMPARISONS = [['lower', 'Mejor que ayer'], ['same', 'Igual que ayer'], ['higher', 'Peor que ayer']];
const WELCOME = {
  id: 'welcome',
  role: 'assistant',
  text: '¡Hola! Soy tu asistente de seguimiento. Cuéntame con tus palabras cómo te sientes hoy y te haré algunas preguntas para que tu odontólogo conozca tu evolución.',
};

function painTone(level) {
  if (level >= 7) return 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100';
  if (level >= 4) return 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100';
  return 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100';
}

export default function ConversationalAssistant({ canReport, onReportSaved }) {
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([WELCOME]);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [text, setText] = useState('');
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const logRef = useRef(null);

  useEffect(() => {
    if (!canReport) return;
    api.get('/assistant/messages/')
      .then(({ data }) => {
        setAiEnabled(Boolean(data.ai_enabled));
        if (data.conversation) {
          setConversation(data.conversation);
          setMessages([WELCOME, ...data.conversation.messages]);
        }
      })
      .catch(() => {});
  }, [canReport]);

  useEffect(() => {
    // Desplaza solo el historial del chat, nunca la página.
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, ready]);

  const collected = conversation?.collected ?? {};

  const send = async (payload) => {
    const previous = messages;
    // Interfaz optimista: el mensaje del paciente aparece al instante, sin esperar al servidor.
    const own = payload.text
      || (payload.pain_level != null ? `Dolor ${payload.pain_level}/10` : COMPARISONS.find(([value]) => value === payload.comparison)?.[1]);
    const optimistic = [...previous, { id: 'pending', role: 'patient', text: own }];
    setMessages(optimistic);
    setSending(true);
    setError('');
    setResult(null);
    try {
      let data;
      if (aiEnabled) {
        // Con IA la respuesta se va mostrando mientras el modelo la escribe.
        data = await streamAssistantMessage(payload, (partial) => {
          setMessages([...optimistic, { id: 'streaming', role: 'assistant', text: partial }]);
        }).catch(() => null);
      }
      // Sin IA, o si la transmisión falla, se usa la petición normal (que además renueva la sesión).
      data ??= (await api.post('/assistant/messages/', payload)).data;
      setConversation(data.conversation);
      setMessages([WELCOME, ...data.conversation.messages]);
      setReady(data.ready_to_submit);
      setText('');
    } catch (requestError) {
      setMessages(previous);
      const detail = requestError.response?.data;
      setError(detail?.detail || detail?.text?.[0] || 'No pude procesar tu mensaje. Inténtalo nuevamente.');
    } finally {
      setSending(false);
    }
  };

  const submitText = (event) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || sending) return;
    send({ text: value });
  };

  const addSymptom = (phrase) => {
    setText((current) => {
      if (current.toLowerCase().includes(phrase.toLowerCase())) return current;
      const base = current.trim();
      return base ? `${base.replace(/[.,]$/, '')}. ${phrase}` : phrase;
    });
  };

  const submitReport = async () => {
    setSending(true);
    setError('');
    try {
      const { data } = await api.post('/assistant/submit/', { conversation: conversation.id });
      setResult(data);
      setConversation(null);
      setMessages([WELCOME]);
      setReady(false);
      onReportSaved?.(data);
    } catch (requestError) {
      setError(requestError.response?.data?.detail || 'No se pudo enviar el reporte. Intenta nuevamente.');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
            <IconSparkles className="h-4 w-4" />
          </span>
          <hgroup>
            <h2 className="text-xs font-bold text-slate-900">Asistente de seguimiento</h2>
            <p className="text-[10px] font-semibold text-slate-500">Tu odontólogo revisa estos reportes</p>
          </hgroup>
        </div>
        <span
          title={aiEnabled ? 'Conversación con inteligencia artificial; el nivel de alerta lo calculan reglas clínicas.' : 'Preguntas guiadas por el protocolo de tu tratamiento.'}
          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${aiEnabled ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-500'}`}
        >
          {aiEnabled ? 'IA' : 'Guiado'}
        </span>
      </header>

      <div className="space-y-4 p-5">
        {!canReport && (
          <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            Podrás conversar con el asistente cuando tu odontólogo registre tu tratamiento.
          </p>
        )}

        {/* aria-busy: el lector de pantalla anuncia la respuesta completa, no cada fragmento. */}
        <ol ref={logRef} role="log" aria-live="polite" aria-busy={sending} aria-label="Conversación con el asistente" className="max-h-80 space-y-2.5 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 [overflow-wrap:anywhere]">
          {messages.map((message) => (
            <li key={message.id} className={`flex ${message.role === 'patient' ? 'justify-end' : 'justify-start'}`}>
              <p className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed shadow-sm ${message.role === 'patient' ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-700'}`}>
                <span className="sr-only">{message.role === 'patient' ? 'Tú: ' : 'Asistente: '}</span>
                {message.text}
              </p>
            </li>
          ))}
          {sending && !messages.some((message) => message.id === 'streaming') && (
            <li className="text-[11px] text-slate-500">El asistente está escribiendo...</li>
          )}
        </ol>

        {result && <ReportResult report={result} />}

        {ready && conversation && (
          <div role="alertdialog" aria-labelledby="ready-title" className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            <p id="ready-title" className="font-bold">¿Envío este reporte a tu odontólogo?</p>
            <p className="mt-1">
              Dolor {collected.pain_level}/10 · {COMPARISONS.find(([value]) => value === collected.comparison)?.[1]}
              {Object.keys(collected.symptoms || {}).length > 0 && ` · ${Object.keys(collected.symptoms).join(', ')}`}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={submitReport} disabled={sending} className="rounded-xl bg-blue-600 px-4 py-2 font-bold text-white hover:bg-blue-700 disabled:opacity-50">
                {sending ? 'Enviando...' : 'Enviar reporte'}
              </button>
              <button type="button" onClick={() => setReady(false)} className="rounded-xl border border-blue-200 bg-white px-4 py-2 font-bold text-blue-800 hover:bg-blue-100">
                Seguir conversando
              </button>
            </div>
          </div>
        )}

        <fieldset disabled={!canReport || sending} className="min-w-0 space-y-3 disabled:opacity-60">
          <legend className="sr-only">Responder al asistente</legend>
          {collected.pain_level == null && (
            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">Tu dolor ahora (EVA 0 - 10)</p>
              <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((level) => (
                  <button key={level} type="button" onClick={() => send({ text: '', pain_level: level })} className={`rounded-xl border py-2 text-sm font-bold transition active:scale-[0.97] ${painTone(level)}`}>
                    {level}
                  </button>
                ))}
              </div>
            </div>
          )}
          {collected.pain_level != null && !collected.comparison && (
            <div className="flex flex-wrap gap-1.5">
              {COMPARISONS.map(([value, label]) => (
                <button key={value} type="button" onClick={() => send({ text: '', comparison: value })} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:bg-blue-50">
                  {label}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {SYMPTOM_SHORTCUTS.map(([label, phrase]) => (
              <button key={label} type="button" onClick={() => addSymptom(phrase)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50">
                + {label}
              </button>
            ))}
          </div>
          <form onSubmit={submitText} className="flex gap-2">
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={1000}
              placeholder="Ej.: se me despegó un bracket y me lastima la mejilla"
              aria-label="Mensaje para el asistente"
              className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-xs text-slate-800 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
            />
            <button type="submit" disabled={!text.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
              <IconSend className="h-3.5 w-3.5" />
              <span>Enviar</span>
            </button>
          </form>
        </fieldset>

        {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
        <p className="text-[11px] text-slate-500">
          El asistente no reemplaza a tu odontólogo: el nivel de alerta lo calculan reglas clínicas validadas.
        </p>
      </div>
    </section>
  );
}

function ReportResult({ report }) {
  return (
    <div role="status" className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700 shadow-sm">
      <p className="flex items-center gap-1.5 font-bold text-slate-900">
        <AlertDot color={report.alert_color} />
        Nivel de alerta: {ALERT_LABELS[report.alert_color] ?? report.risk_level}
      </p>
      <p className="mt-0.5 text-slate-600">{report.evolution_status}</p>
      {report.alert_reasons?.length > 0 && <p className="mt-0.5 text-slate-600">Motivo: {report.alert_reasons.join('; ')}</p>}
      <SymptomChips entities={report.extracted_entities} />
      <p className="mt-2 leading-relaxed">{report.recommendation}</p>
      {report.doctor_notified && (
        <p className="mt-1 font-bold text-rose-600">⚠ Tu odontólogo verá esta alerta en su panel. Si es urgente, llama a la clínica.</p>
      )}
    </div>
  );
}
