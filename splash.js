/* ═══════════════════════════════════════════════════════════════════
   SPLASH.JS — tela de carregamento (carrega ANTES de tudo)
   • os elementos já existem: este script vem DEPOIS do #splash no HTML
   • some sozinha quando o app sinaliza "pronto"
   • detecta arquivo .js que não carregou → erro + "Tentar novamente"
   • nunca deixa o usuário preso em tela branca
   ═══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var el = document.getElementById('splash');
  var box = document.getElementById('splash-box');
  var bar = document.getElementById('splash-bar');
  var label = document.getElementById('splash-label');
  var errBox = document.getElementById('splash-error');
  var errText = document.getElementById('splash-error-text');
  var done = false, failed = false, failMsg = '';

  /* ── algum arquivo nosso não carregou (404 / rede) ── */
  window.addEventListener('error', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'SCRIPT' || !t.src) return;
    if (/unpkg\.com|googleapis\.com|gstatic\.com/.test(t.src)) return; /* CDN: não bloqueia */
    var name = String(t.src).split('/').pop() || t.src;
    fail('Não foi possível carregar o arquivo «' + name + '». Confira a conexão ou o deploy.');
  }, true);

  /* ── erro JS não tratado: só vira tela de erro se o app não prontificar ── */
  window.addEventListener('error', function (e) {
    if (done || failed || !e || !e.message) return;
    var msg = e.message;
    setTimeout(function () { if (!done && !failed) fail('Erro ao iniciar: ' + msg); }, 1500);
  });
  window.addEventListener('unhandledrejection', function (e) {
    if (done || failed) return;
    var m = e && e.reason && (e.reason.message || String(e.reason));
    if (!m) return;
    setTimeout(function () { if (!done && !failed) fail('Erro ao iniciar: ' + m); }, 1500);
  });
  window.addEventListener('offline', function () {
    if (!done && !failed) fail('Sem conexão com a internet.');
  });

  /* rede muito lenta */
  setTimeout(function () {
    if (!done && !failed) fail('A página demorou demais para carregar.');
  }, 25000);

  step('Carregando…', 12);

  function step(text, pct) {
    if (text && label) label.textContent = text;
    if (typeof pct === 'number' && bar) {
      bar.style.width = Math.max(0, Math.min(100, pct)) + '%';
    }
  }

  function doneFn() {
    if (failed) return;
    done = true;
    if (bar) bar.style.width = '100%';
    if (!el) return;
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { if (el && el.parentNode) el.parentNode.removeChild(el); }, 600);
    }, 220);
  }

  function fail(msg) {
    if (done) return;
    failed = true;
    failMsg = msg || 'Não foi possível carregar a página.';
    step('Algo deu errado', 100);
    if (box) box.classList.add('hidden');
    if (!errBox) { paintFallback(); return; }
    errBox.classList.remove('hidden');
    if (errText) errText.textContent = failMsg;
    var btn = document.getElementById('splash-retry');
    if (btn && !btn.dataset.wired) {
      btn.dataset.wired = '1';
      btn.onclick = function () { location.reload(); };
    }
  }

  /* último recurso: monta o aviso na mão, sempre via textContent */
  function paintFallback() {
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;gap:16px;' +
      'align-items:center;justify-content:center;font-family:sans-serif;text-align:center;' +
      'padding:24px;z-index:99999;background:#F4EFE6;color:#1D1A16';
    var p = document.createElement('p');
    p.textContent = failMsg;
    var b = document.createElement('button');
    b.textContent = 'Tentar novamente';
    b.style.cssText = 'padding:12px 24px;border:1px solid #1D1A16;border-radius:999px;cursor:pointer';
    b.onclick = function () { location.reload(); };
    d.appendChild(p); d.appendChild(b);
    document.body.appendChild(d);
  }

  window.Splash = { step: step, done: doneFn, fail: fail, isDone: function () { return done; } };
})();
