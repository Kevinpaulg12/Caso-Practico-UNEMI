// RNF01 en tiempo real: sesión abierta, sin interacción durante más de 5 minutos.
import { chromium } from 'playwright';
import fs from 'node:fs';

const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:5173';
const API = 'http://127.0.0.1:8000/api';
const lines = [];
const note = (text) => { const line = `${new Date().toLocaleTimeString('es-EC')}  ${text}`; lines.push(line); console.log(line); };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
await page.goto(BASE + '/login');
await page.fill('#username', 'maria.torres');
await page.fill('#password', 'PacienteDemo2026!');
await page.click('button[type=submit]');
await page.waitForURL('**/panel-paciente');
const token = await page.evaluate(() => localStorage.getItem('access_token'));
const refresh = await page.evaluate(() => localStorage.getItem('refresh_token'));
note(`Sesión iniciada: ${page.url()}`);

const check = async (label) => {
  const response = await fetch(`${API}/me/`, { headers: { Authorization: `Bearer ${token}`, 'X-Background-Request': '1' } });
  note(`${label}: GET /api/me/ con el token de la sesión -> ${response.status}`);
};
await check('Minuto 0');
await page.waitForTimeout(4 * 60000);
note(`Minuto 4 sin interacción: la página sigue en ${new URL(page.url()).pathname}`);
await page.waitForTimeout(80000);
const url = page.url();
const message = await page.locator('[role=status]').first().textContent().catch(() => '');
note(`Minuto 5:20 sin interacción: la página está en ${new URL(url).pathname}${new URL(url).search}`);
note(`Mensaje mostrado: ${message.trim()}`);
const response = await fetch(`${API}/me/`, { headers: { Authorization: `Bearer ${token}` } });
note(`Minuto 5:20: GET /api/me/ con el token de acceso anterior -> ${response.status} (${(await response.json()).code})`);
const renewal = await fetch(`${API}/token/refresh/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh }) });
const renewalBody = await renewal.json();
note(`Minuto 5:20: POST /api/token/refresh/ con el token de renovación -> ${renewal.status} (${renewalBody.code}: ${renewalBody.detail})`);
await page.screenshot({ path: `${OUT}/RNF01-sesion-cerrada-por-inactividad.png` });
const ok = new URL(url).pathname === '/login' && message.includes('inactividad') && response.status === 401
  && renewal.status === 401 && renewalBody.code === 'session_idle';
note(ok ? 'RESULTADO: CUMPLE RNF01' : 'RESULTADO: NO CUMPLE RNF01');
fs.writeFileSync(`${OUT}/RNF01-registro.txt`, lines.join('\n') + '\n');
await browser.close();
