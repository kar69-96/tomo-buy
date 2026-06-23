/**
 * The minimal text/portal surface (§14 UI). A single static HTML+JS page served
 * at `GET /`: type a prompt → drives /intent → /route → /execute, shows the routed
 * plan + cart + total, and offers approve / reject + an OTP-relay field. Kept tiny
 * and dependency-free on purpose (CLAUDE.md: minimal UI).
 *
 * It never sees a secret: the portal only renders intent/route/status JSON the api
 * returns, all of which is secret-free by construction.
 */
export function renderPortal(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Tomo-buy — Lane B P2 guest checkout</title>
<style>
  body { font: 15px/1.5 system-ui, sans-serif; max-width: 680px; margin: 2rem auto; padding: 0 1rem; color: #111; }
  h1 { font-size: 1.25rem; }
  textarea, input { width: 100%; box-sizing: border-box; padding: .5rem; font: inherit; }
  button { padding: .5rem 1rem; font: inherit; cursor: pointer; margin-right: .5rem; }
  .card { border: 1px solid #ddd; border-radius: 8px; padding: 1rem; margin: 1rem 0; }
  .muted { color: #666; }
  pre { background: #f6f6f6; padding: .75rem; border-radius: 6px; overflow-x: auto; }
  .row { display: flex; gap: .5rem; align-items: center; }
  .hidden { display: none; }
</style>
</head>
<body>
<h1>Tomo-buy — guest checkout (Lane B · P2)</h1>
<p class="muted">The agent emits intent only. Secrets are injected trusted-side; this page never sees a PAN.</p>

<div class="card">
  <label for="userId">User</label>
  <input id="userId" value="user-demo" />
  <label for="prompt">What should I buy?</label>
  <textarea id="prompt" rows="3">Order a large oat latte from Test Coffee for pickup, up to $20.</textarea>
  <div style="margin-top:.5rem"><button id="planBtn">Plan it</button></div>
</div>

<div id="plan" class="card hidden">
  <h2 style="font-size:1rem">Routed plan</h2>
  <pre id="planOut"></pre>
  <div class="row">
    <label for="estimate">Estimate (cents)</label>
    <input id="estimate" type="number" value="1800" style="max-width:140px" />
    <button id="execBtn">Start checkout</button>
  </div>
</div>

<div id="approve" class="card hidden">
  <h2 style="font-size:1rem">Approval gate</h2>
  <p class="muted">Workflow <code id="wfId"></code> — status <code id="wfStatus">…</code></p>
  <div class="row">
    <label for="approvedTotal">Approved total (cents)</label>
    <input id="approvedTotal" type="number" value="1800" style="max-width:140px" />
    <button id="approveBtn">Approve</button>
    <button id="rejectBtn">Reject</button>
  </div>
  <div class="row" style="margin-top:.5rem">
    <label for="otp">OTP relay</label>
    <input id="otp" placeholder="123456" style="max-width:160px" />
    <button id="otpBtn">Relay code</button>
  </div>
</div>

<div id="result" class="card hidden">
  <h2 style="font-size:1rem">Final state</h2>
  <pre id="resultOut"></pre>
</div>

<script>
const $ = (id) => document.getElementById(id);
let workflowId = null;
let lastIntent = null;
let lastRouting = null;

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

$('planBtn').onclick = async () => {
  const intentRes = await post('/intent', { userId: $('userId').value, text: $('prompt').value });
  if (!intentRes.success) return alert('intent: ' + intentRes.error);
  lastIntent = intentRes.data.intent;
  const routeRes = await post('/route', lastIntent);
  if (!routeRes.success) return alert('route: ' + routeRes.error);
  lastRouting = routeRes.data;
  $('planOut').textContent = JSON.stringify({ intent: lastIntent, routing: lastRouting }, null, 2);
  $('plan').classList.remove('hidden');
};

$('execBtn').onclick = async () => {
  const res = await post('/execute', {
    userId: $('userId').value,
    intent: lastIntent,
    routing: lastRouting,
    estimateCents: Number($('estimate').value),
  });
  if (!res.success) return alert('execute: ' + res.error);
  workflowId = res.data.workflowId;
  $('wfId').textContent = workflowId;
  $('approve').classList.remove('hidden');
  poll();
};

async function poll() {
  if (!workflowId) return;
  const res = await fetch('/workflow/' + encodeURIComponent(workflowId));
  const json = await res.json();
  if (json.success) {
    $('wfStatus').textContent = json.data.status;
    const terminal = ['SETTLED', 'DECLINED', 'ABANDONED', 'NEEDS_RECON'];
    if (terminal.includes(json.data.status)) {
      $('resultOut').textContent = JSON.stringify(json.data, null, 2);
      $('result').classList.remove('hidden');
      return;
    }
  }
  setTimeout(poll, 1000);
}

$('approveBtn').onclick = async () => {
  const res = await post('/approval/resolve', { workflowId, decision: 'approve', approvedTotalCents: Number($('approvedTotal').value) });
  if (!res.success) return alert('approve: ' + res.error);
};
$('rejectBtn').onclick = async () => {
  const res = await post('/approval/resolve', { workflowId, decision: 'reject' });
  if (!res.success) return alert('reject: ' + res.error);
};
$('otpBtn').onclick = async () => {
  const res = await post('/otp/relay', { workflowId, code: $('otp').value });
  if (!res.success) return alert('otp: ' + res.error);
  $('otp').value = '';
};
</script>
</body>
</html>`;
}
