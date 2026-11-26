import { useEffect, useRef, useState } from 'react';
import api from '../../services/api';
import { streamAssistantMessage } from '../../services/assistantStream';
import { IconCalendar, IconCheck, IconPlus, IconSend, IconSparkles } from '../Icons';
import { ContactButton } from './SafetyNotice';

// Atajos para describir cómo se siente con palabras que el sistema reconoce (RU01: registro guiado).
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
  text: '¡Hola! Estoy aquí para acompañarte en tu tratamiento. Cuéntame con tus palabras cómo te sientes hoy. Si tienes dudas sobre tus cuidados o necesitas una cita, también puedes escribírmelo.',
};

// Tras el alta ya no hay seguimiento diario: el asistente sirve para pedir una cita o aclarar indicaciones.
const DISCHARGED_WELCOME = {
  id: 'welcome',
  role: 'assistant',
  text: 'Tu odontólogo te dio de alta. Si necesitas volver a consulta, puedo pedir una cita por ti; también puedo recordarte las indicaciones de tu último tratamiento.',
};

function today() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// Respuestas rápidas según lo que acaba de preguntar el asistente.
function quickReplies(message) {
  if (!message || message.role !== 'assistant') return { kind: null };
  if (message.choices?.length) return { kind: 'choices', choices: message.choices, date: message.input === 'date' };
  if (/del 0 al 10/i.test(message.text)) return { kind: 'pain' };
  if (/mejor, igual o peor/i.test(message.text)) return { kind: 'comparison' };
  return { kind: null };
}

export default function ConversationalAssistant({ canTalk, onActivity, contact = null, discharged = false }) {
  const greeting = discharged ? DISCHARGED_WELCOME : WELCOME;
  const [messages, setMessages] = useState([greeting]);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [text, setText] = useState('');
  const [chosenDate, setChosenDate] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const logRef = useRef(null);

  useEffect(() => {
    if (!canTalk) return;
    api.get('/assistant/messages/')
      .then(({ data }) => {
        setAiEnabled(Boolean(data.ai_enabled));
        setMessages([greeting, ...(data.conversation?.messages ?? [])]);
      })
      .catch(() => {});
  }, [canTalk, greeting]);

  useEffect(() => {
    // Desplaza solo el historial del chat, nunca la página.
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages]);

  const replies = sending ? { kind: null } : quickReplies(messages[messages.length - 1]);

  const send = async (payload, shown) => {
    const previous = messages;
    // Interfaz optimista: el mensaje del paciente aparece al instante, sin esperar al servidor.
    const optimistic = [...previous, { id: 'pending', role: 'patient', text: shown ?? payload.text }];
    setMessages(optimistic);
    setSending(true);
    setError('');
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
      setMessages([greeting, ...data.conversation.messages]);
      setText('');
      setChosenDate('');
      onActivity?.();
    } catch (requestError) {
      setMessages(previous);
      const detail = requestError.response?.data;
      setError(detail?.detail || detail?.text?.[0] || detail?.appointment_date?.[0] || 'No pude procesar tu mensaje. Inténtalo nuevamente.');
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

  const sendDate = (event) => {
    event.preventDefault();
    if (chosenDate) send({ text: '', appointment_date: chosenDate }, new Date(`${chosenDate}T00:00:00`).toLocaleDateString('es-EC', { weekday: 'long', day: 'numeric', month: 'long' }));
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/60 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
            <IconSparkles className="h-4 w-4" />
          </span>
          <hgroup>
            <h2 className="text-xs font-bold text-slate-900">Tu asistente de acompañamiento</h2>
            <p className="text-[10px] font-semibold text-slate-500">Lo que me cuentes llega a tu odontólogo</p>
          </hgroup>
        </div>
        <span
          title={aiEnabled ? 'Conversación con inteligencia artificial.' : 'Preguntas guiadas por el protocolo de tu tratamiento.'}
          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${aiEnabled ? 'border-violet-200 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-500'}`}
        >
          {aiEnabled ? 'IA' : 'Guiado'}
        </span>
      </header>

      <div className="space-y-4 p-5">
        {!canTalk && (
          <p role="status" className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            Podrás conversar con el asistente cuando tu odontólogo registre tu tratamiento.
          </p>
        )}

        {/* aria-busy: el lector de pantalla anuncia la respuesta completa, no cada fragmento. */}
        <ol ref={logRef} role="log" aria-live="polite" aria-busy={sending} aria-label="Conversación con el asistente" className="max-h-96 space-y-2.5 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 [overflow-wrap:anywhere]">
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

        <fieldset disabled={!canTalk || sending} className="min-w-0 space-y-3 disabled:opacity-60">
          <legend className="sr-only">Responder al asistente</legend>
          {replies.kind === 'pain' && (
            <div role="group" aria-label="Tu dolor ahora, de 0 a 10">
              <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((level) => (
                  <button key={level} type="button" onClick={() => send({ text: '', pain_level: level }, `Dolor ${level}/10`)} className="rounded-xl border border-slate-200 bg-white py-2 text-sm font-bold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50 active:scale-[0.97]">
                    {level}
                  </button>
                ))}
              </div>
            </div>
          )}
          {replies.kind === 'comparison' && (
            <div role="group" aria-label="Comparado con ayer" className="flex flex-wrap gap-1.5">
              {COMPARISONS.map(([value, label]) => (
                <button key={value} type="button" onClick={() => send({ text: '', comparison: value }, label)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:bg-blue-50">
                  {label}
                </button>
              ))}
            </div>
          )}
          {replies.kind === 'choices' && (
            <div role="group" aria-label="Respuestas sugeridas" className="flex flex-wrap items-end gap-1.5">
              {replies.choices.map((choice) => (
                <button key={choice} type="button" onClick={() => send({ text: choice })} className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100">
                  {choice}
                </button>
              ))}
              {replies.date && (
                <form onSubmit={sendDate} className="flex items-end gap-1.5">
                  <label className="text-[11px] font-semibold text-slate-600">
                    Otra fecha
                    <input type="date" value={chosenDate} min={today()} onChange={(event) => setChosenDate(event.target.value)} className="ml-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs" />
                  </label>
                  <button type="submit" disabled={!chosenDate} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1 text-xs font-bold text-white disabled:opacity-50">
                    <IconCheck className="h-3.5 w-3.5" />Elegir
                  </button>
                </form>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">
            {!discharged && SYMPTOM_SHORTCUTS.map(([label, phrase]) => (
              <button key={label} type="button" onClick={() => addSymptom(phrase)} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-blue-300 hover:bg-blue-50">
                <IconPlus className="h-3 w-3 text-slate-400" />{label}
              </button>
            ))}
            <button type="button" onClick={() => send({ text: 'Quiero pedir una cita de revisión' })} className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100">
              <IconCalendar className="h-3.5 w-3.5" />Pedir una cita
            </button>
          </div>
        </fieldset>

        {/* Escribir, enviar y, al lado, el contacto: este último nunca se deshabilita. */}
        <div className="flex flex-wrap items-stretch gap-2 sm:flex-nowrap">
          <fieldset disabled={!canTalk || sending} className="min-w-0 flex-1 basis-full disabled:opacity-60 sm:basis-auto">
            <legend className="sr-only">Escribir al asistente</legend>
            <form onSubmit={submitText} className="flex gap-2">
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={1000}
                placeholder={discharged ? "Ej.: quiero una cita de revisión la próxima semana" : "Ej.: se me despegó un bracket y me lastima la mejilla"}
                aria-label="Mensaje para el asistente"
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-xs text-slate-800 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
              />
              <button type="submit" disabled={!text.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
                <IconSend className="h-3.5 w-3.5" />
                <span>Enviar</span>
              </button>
            </form>
          </fieldset>
          <div className="ml-auto sm:ml-0">
            <ContactButton contact={contact} />
          </div>
        </div>

        {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
        <p className="text-[11px] text-slate-500">
          El asistente no reemplaza a tu odontólogo. Cuando preguntes qué hacer, te responderá solo con las indicaciones que él te dejó.
        </p>
      </div>
    </section>
  );
}
