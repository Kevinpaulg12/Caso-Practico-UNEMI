// Verificación de requisitos en navegador real + capturas de evidencia.
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = process.argv[2];
const BASE = 'http://localhost:5173';
const API = 'http://127.0.0.1:8000/api';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const log = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} [${id}] ${name}${detail ? ' :: ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function newPage(width = 1280, height = 860) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: width <= 400 ? 2 : 1, locale: 'es-EC' });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('401')) errors.push(m.text()); });
  return page;
}
async function login(page, user, pass) {
  await page.goto(BASE + '/login');
  await page.fill('#username', user);
  await page.fill('#password', pass);
  await page.click('button[type=submit]');
}
const shot = (page, name, full = true) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });

// RNF03: nada interactivo fuera del ancho y sin desplazamiento horizontal.
async function responsive(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const scroll = document.documentElement.scrollWidth;
    const bad = [];
    for (const el of document.querySelectorAll('button, a[href], input, select, textarea, summary')) {
      if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      let clipped = false;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll') { clipped = true; break; }
      }
      if (clipped) continue;
      if (r.left < -1 || r.right > vw + 1) bad.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.placeholder || el.name || '').trim().slice(0, 30)}" ${Math.round(r.left)}-${Math.round(r.right)}`);
    }
    return { vw, scroll, bad, count: document.querySelectorAll('button, a[href], input, select, textarea').length };
  });
}
async function checkResponsive(page, id, label, name) {
  const r = await responsive(page);
  log(id, `${label} a 320 px: sin desplazamiento horizontal`, r.scroll <= r.vw, `scrollWidth=${r.scroll}, ancho=${r.vw}`);
  log(id, `${label} a 320 px: ${r.count} elementos interactivos dentro de la pantalla`, r.bad.length === 0, r.bad.slice(0, 3).join(' | '));
  await shot(page, name);
}

// ---------- RF01 / HU01
{
  const page = await newPage();
  await login(page, 'doctor.demo', 'DoctorDemo2026!');
  await page.waitForURL('**/panel-doctor', { timeout: 15000 });
  log('RF01-CA01 / HU01-CA01', 'Odontólogo con credenciales válidas llega a su panel', page.url().endsWith('/panel-doctor'), page.url());
  await page.goto(BASE + '/panel-paciente');
  await page.waitForTimeout(500);
  log('RF01-CA01', 'El odontólogo no accede a la interfaz del paciente', !page.url().endsWith('/panel-paciente'), page.url());
  await page.context().close();

  const p = await newPage();
  await login(p, 'paciente.demo', 'PacienteDemo2026!');
  await p.waitForURL('**/panel-paciente', { timeout: 15000 });
  log('RF01-CA01 / HU01-CA02', 'Paciente con credenciales válidas llega a su interfaz de reportes', p.url().endsWith('/panel-paciente'), p.url());
  await p.goto(BASE + '/panel-doctor');
  await p.waitForTimeout(500);
  log('RF01-CA01', 'El paciente no accede al panel del odontólogo', !p.url().endsWith('/panel-doctor'), p.url());
  await p.context().close();

  const bad = await newPage();
  await login(bad, 'doctor.demo', 'clave-incorrecta');
  const alert = await bad.locator('[role=alert]').textContent({ timeout: 10000 });
  log('RF01-CA02', 'Credenciales inválidas: acceso denegado con mensaje', bad.url().includes('/login') && /inválid/i.test(alert), alert.trim());
  await shot(bad, 'RF01-CA02-credenciales-invalidas', false);
  await bad.context().close();
}

// ---------- RF03 / HU03 (panel del odontólogo)
{
  const page = await newPage(1366, 900);
  await login(page, 'doctor.demo', 'DoctorDemo2026!');
  await page.waitForURL('**/panel-doctor');
  await page.waitForSelector('text=/pacientes$/');
  const cards = await page.locator('section button h3').allTextContents();
  const badges = await page.locator('section button span.rounded-full').allTextContents();
  log('RF03-CA01 / HU03-CA01', 'La lista empieza por las alertas rojas', /Rojo/.test(badges[0] || ''), `${cards[0]} → ${badges[0]}`);
  log('HU03-CA01', 'Indicadores rojo, amarillo y verde visibles', ['Rojo', 'Amarillo', 'Verde'].every((c) => badges.some((b) => b.startsWith(c))), badges.join(' / '));
  await page.waitForSelector('.recharts-surface', { timeout: 15000 });
  const points = await page.locator('.recharts-line-dots circle').count();
  log('RF03-CA02 / HU03-CA02', 'Al elegir un paciente se dibuja su gráfica histórica de EVA', points >= 4, `${points} puntos reportados`);
  await page.locator('details summary').click();
  const rows = await page.locator('details tbody tr').count();
  log('RF03-CA02', 'Los datos de la gráfica provienen de los autorreportes (tabla equivalente)', rows >= 5, `${rows} días`);
  await page.locator('.recharts-line-dots circle').nth(3).hover();
  await page.waitForTimeout(300);
  const tip = await page.locator('.recharts-tooltip-wrapper').textContent();
  log('RF03-CA02', 'Tooltip con día, EVA y nivel', /Día \d/.test(tip), tip.trim());
  await shot(page, 'RF03-panel-odontologo-grafica');
  await page.locator('section button', { hasText: 'Lucía Mora' }).click();
  await page.waitForSelector('text=/hoy es el día [0-9]+/');
  await shot(page, 'RF03-panel-odontologo-otro-paciente', false);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(400);
  await checkResponsive(page, 'RNF03', 'Panel del odontólogo', 'RNF03-panel-odontologo-320');
  await page.context().close();
}

// ---------- RF04 / HU04: registro de procedimiento
{
  const page = await newPage(1366, 900);
  await login(page, 'doctor.demo', 'DoctorDemo2026!');
  await page.waitForURL('**/panel-doctor');
  await page.goto(BASE + '/panel-doctor/nueva-consulta');
  await page.fill('input[placeholder="Ej. 1723456789"]', '1712345673');
  await page.click('text=Buscar ficha');
  await page.waitForSelector('select[name=clinical_procedure] option:has-text("Endodoncia")', { state: 'attached', timeout: 15000 });
  const options = await page.locator('select[name=clinical_procedure] option').allTextContents();
  log('RF04-CA01 / HU04-CA01', 'El formulario permite seleccionar el tipo de cirugía', options.some((o) => /Exodoncia/.test(o)) && options.some((o) => /Endodoncia/.test(o)), options.slice(1).join(' | '));
  await page.fill('#medication-search', 'Paracetamol');
  await page.fill('input[name=active_ingredient]', 'Paracetamol');
  await page.selectOption('select[name=strength]', '500 mg');
  await page.selectOption('select[name=dosage_form]', 'Tableta');
  await page.selectOption('select[name=frequency]', 'Cada 8 horas');
  await page.fill('input[name=duration]', '3');
  await page.selectOption('select[name=clinical_procedure]', { label: 'Endodoncia (tratamiento de conducto)' });
  const y = new Date(Date.now() - 86400000);
  const surgery = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  await page.fill('input[name=surgery_date]', surgery);
  await page.fill('input[name=admission_reason]', 'Control tras endodoncia');
  await page.fill('textarea[name=instructions]', 'Evita masticar del lado tratado durante 24 horas.\nToma el analgésico solo si hay dolor.');
  await shot(page, 'RF04-formulario-procedimiento');
  await page.click('button:has-text("Guardar receta y tratamiento")');
  await page.waitForSelector('text=Consulta registrada', { timeout: 15000 });
  log('RF04-CA01', 'El procedimiento con su fecha se guarda', true);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(400);
  await checkResponsive(page, 'RNF03', 'Registro de procedimiento', 'RNF03-registro-procedimiento-320');
  await page.context().close();

  const patient = await newPage(1280, 900);
  await login(patient, 'lucia.mora', 'PacienteDemo2026!');
  await patient.waitForURL('**/panel-paciente');
  await patient.waitForSelector('text=Tu recuperación');
  const timeline = await patient.locator('section:has-text("Tu recuperación")').first().textContent();
  log('RF04-CA02 / HU04-CA02', 'La línea de tiempo empieza en la fecha de la cirugía', /Día 1 después de la cirugía/.test(timeline), timeline.replace(/\s+/g, ' ').trim().slice(0, 120));
  const exact = await patient.locator('p', { hasText: 'Evita masticar del lado tratado' }).first().innerText();
  log('RF04-CA01 / HU05-CA01', 'El paciente ve el texto exacto registrado por el odontólogo', exact.includes('Evita masticar del lado tratado durante 24 horas.') && exact.includes('Toma el analgésico solo si hay dolor.'), exact.replace(/\n/g, ' ⏎ ').slice(0, 120));
  await shot(patient, 'RF04-HU05-indicaciones-paciente');
  await patient.context().close();
}

// ---------- RF02 / HU02 (chat) + RNF03 en el portal
{
  const page = await newPage(390, 844);
  await login(page, 'jorge.vera', 'PacienteDemo2026!');
  await page.waitForURL('**/panel-paciente');
  await page.waitForSelector('text=¿Qué notas hoy?');
  await page.click('button:has-text("= Igual molestia")');
  await page.getByRole('button', { name: '3', exact: true }).click();
  await page.click('button:has-text("+ Sangrado")');
  await page.fill('[aria-label="Mensaje para el asistente"]', 'Me sigue sangrando un poco y la mejilla está algo hinchada');
  const t0 = Date.now();
  await page.click('button:has-text("Enviar")');
  await page.waitForSelector('text=/Nivel de alerta:/', { timeout: 15000 });
  const level = await page.locator('text=/Nivel de alerta:/').last().textContent();
  const chips = await page.locator('span:has-text("(leve)"), span:has-text("Inflamación")').allTextContents();
  log('RF02-CA01 / HU02-CA01', 'Se extraen los síntomas del mensaje', chips.length > 0, chips.join(', '));
  log('RF02-CA02 / HU02-CA02', 'Se asigna un nivel de alerta según síntoma y día (día 3)', /amarilla/i.test(level), level.trim());
  log('HU02', 'Respuesta visible en el chat', true, `${Date.now() - t0} ms en el navegador`);
  await shot(page, 'RF02-HU02-chat-alerta-390');
  await page.setViewportSize({ width: 320, height: 800 });
  await page.waitForTimeout(400);
  await checkResponsive(page, 'RNF03 / HU02-CA03 / HU05-CA02', 'Portal del paciente (autorreporte)', 'RNF03-portal-paciente-320');
  await page.context().close();

  const loginPage = await newPage(320, 700);
  await loginPage.goto(BASE + '/login');
  await checkResponsive(loginPage, 'RNF03', 'Inicio de sesión', 'RNF03-login-320');
  await loginPage.context().close();
}

// ---------- RNF02 sobre HTTP real
{
  const token = (await (await fetch(`${API}/token/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'paciente.demo', password: 'PacienteDemo2026!' }),
  })).json()).access;
  const durations = [];
  for (let i = 0; i < 50; i += 1) {
    const start = performance.now();
    const response = await fetch(`${API}/patient-reports/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ pain_level: i % 11, comparison: 'same', message: 'Tengo un poco de dolor y algo de inflamación en la mejilla' }),
    });
    await response.json();
    durations.push(performance.now() - start);
    if (response.status !== 201) throw new Error(`status ${response.status}`);
  }
  durations.sort((a, b) => a - b);
  const p95 = durations[Math.ceil(0.95 * durations.length) - 1];
  const max = durations.at(-1);
  log('RNF02', 'Autorreporte por HTTP responde en máximo 200 ms', max <= 200,
    `50 envíos: mediana ${durations[25].toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, máximo ${max.toFixed(1)} ms`);
}

log('General', 'Sin errores de JavaScript en consola', errors.length === 0, errors.slice(0, 3).join(' | '));
fs.writeFileSync(`${OUT}/resultados.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\nTOTAL ${results.length} · PASS ${results.length - failed} · FAIL ${failed}`);
await browser.close();
