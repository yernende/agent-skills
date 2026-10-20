import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

const html = `<!doctype html><html lang="ru"><meta charset="utf-8">
<title>Browser Video QA — локальный пример</title>
<style>
  *{box-sizing:border-box}body{margin:0;background:#edf1f6;color:#17243a;font:18px/1.5 Arial,sans-serif}
  main{max-width:1240px;margin:100px auto 40px;padding:0 28px 120px}h1{font-size:36px;margin:8px 0}h2{font-size:24px}
  .tag{display:inline-block;background:#d9e8fb;color:#184d8c;padding:5px 14px;border-radius:20px;font-size:15px}
  .cards{display:grid;grid-template-columns:1.4fr 1fr;gap:24px;margin:32px 0}
  section{background:white;border:1px solid #cbd5e3;border-radius:18px;padding:28px;box-shadow:0 8px 30px #17243a09}
  .surface{height:240px;position:relative;border-radius:12px;background:#f5f7fa;border:1px solid #ccd5e2}
  .surface:before{content:"";position:absolute;left:24px;right:24px;top:118px;border-top:3px solid #a5b5cb}
  #handle{position:absolute;top:93px;left:20%;width:52px;height:52px;transform:translateX(-50%);border:0;border-radius:50%;background:#0764d9;color:white;font-size:28px;cursor:grab;touch-action:none;box-shadow:0 3px 8px #0764d966}
  .ticks{display:flex;justify-content:space-between;margin-top:12px;color:#526177}.dark{background:#14243c;color:#f1f5fd}
  .dark .surface{background:#0c172a;border-color:#43536a;display:flex;align-items:center;justify-content:center;color:#a9c8ef}
  .dark .surface:before{display:none}.value{font-size:40px;font-weight:bold;color:#0764d9;margin:16px 0 0}
  label{display:block;font-weight:bold;margin-bottom:10px}input{font:inherit;padding:12px;border-radius:8px;border:1px solid #8093af;width:100%;max-width:620px}
  #save{background:#086747;color:white;border:0;border-radius:10px;padding:14px 24px;font:inherit;cursor:pointer}
  dialog{border:1px solid #8093af;border-radius:16px;padding:36px;width:760px;height:360px;color:#17243a}
  dialog::backdrop{background:#14243c88}dialog input{width:auto}dialog button,#open-dialog{font:inherit;padding:10px 18px;border-radius:8px;border:1px solid #8093af;cursor:pointer}
  .spacer{height:190px}.hint{color:#526177;font-size:16px}#status{min-height:30px;font-weight:bold}
</style><main>
<span class="tag">ЛОКАЛЬНЫЙ ПРИМЕР · настоящий HTTP · без внешних данных</span>
<h1>Проверка записи браузера</h1><p>Курсор, ввод, перетаскивание и сохранение после перезагрузки.</p>
<div class="cards"><section><h2>Перетащите маркер</h2><div class="surface" id="surface"><button id="handle" aria-label="Маркер положения">↔</button></div>
<div class="ticks"><span>0%</span><span>50%</span><span>100%</span></div><p class="value"><output id="position">20</output>%</p></section>
<section class="dark"><h2>Курсор на тёмном фоне</h2><div class="surface" id="dark">Белая стрелка остаётся видимой</div><p>Синее кольцо показывает нажатие.</p></section></div>
<section><label for="name">Название проверки</label><input id="name"><p class="hint">Изменения сохраняются через локальный API, затем читаются заново.</p>
<div class="spacer"></div><button id="save">Сохранить через HTTP</button><p id="status" role="status">Загрузка…</p>
<button id="open-dialog">Открыть диалог</button></section></main>
<dialog id="modal"><h2>Обычный HTML-диалог</h2><p>Курсор и подпись должны оставаться видимыми над модальным окном.</p>
<label><input type="checkbox" id="modal-check"> Ввод в диалоге работает</label><button id="close-dialog">Закрыть диалог</button></dialog>
<script>
  let position = 20;
  const surface = document.querySelector('#surface'), handle = document.querySelector('#handle');
  const nameInput = document.querySelector('#name'), status = document.querySelector('#status');
  function render() { handle.style.left = position + '%'; document.querySelector('#position').textContent = position; }
  function move(event) { const bounds = surface.getBoundingClientRect(); position = Math.max(0, Math.min(100, Math.round((event.clientX - bounds.left) / bounds.width * 100))); render(); }
  handle.addEventListener('pointerdown', event => { handle.setPointerCapture(event.pointerId); move(event); });
  handle.addEventListener('pointermove', event => { if (handle.hasPointerCapture(event.pointerId)) move(event); });
  handle.addEventListener('pointerup', event => { handle.releasePointerCapture(event.pointerId); });
  document.querySelector('#save').addEventListener('click', async () => {
    const response = await fetch('/api/state', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ name:nameInput.value, position }) });
    status.textContent = response.ok ? 'Сохранено через HTTP' : 'Ошибка сохранения';
  });
  document.querySelector('#open-dialog').addEventListener('click', () => document.querySelector('#modal').showModal());
  document.querySelector('#close-dialog').addEventListener('click', () => document.querySelector('#modal').close());
  fetch('/api/state').then(response => response.json()).then(saved => { position = saved.position; nameInput.value = saved.name; render(); status.textContent = 'Данные загружены'; });
</script></html>`;

export async function startFixture() {
  let state = { name: "Пример", position: 20 };
  const server = createServer(async (request, response) => {
    if (request.url === "/api/state") {
      response.setHeader("Content-Type", "application/json");
      if (request.method === "PUT") {
        try {
          let body = "";
          for await (const chunk of request) body += chunk;
          const candidate = JSON.parse(body);
          if (typeof candidate.name !== "string" || !candidate.name.trim() ||
              !Number.isFinite(candidate.position) || candidate.position < 0 || candidate.position > 100) {
            response.writeHead(400).end(JSON.stringify({ error: "Invalid state" }));
            return;
          }
          state = { name: candidate.name, position: candidate.position };
        } catch {
          response.writeHead(400).end(JSON.stringify({ error: "Invalid JSON" }));
          return;
        }
      }
      response.end(JSON.stringify(state));
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(html);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fixture = await startFixture();
  process.stdout.write(`${fixture.url}\n`);
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await fixture.close(); });
}
