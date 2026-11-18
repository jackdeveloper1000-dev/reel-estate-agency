/**
 * Razorpay pay-per-film.
 *   GET  /api/payments/summary  → { price, currency, credits, mode, keyId }
 *   POST /api/payments/order    → creates a Razorpay order for one film
 *   POST /api/payments/verify   { razorpay_order_id, razorpay_payment_id, razorpay_signature } → marks paid (+1 credit)
 *   GET  /api/payments          → the user's payment history
 *
 * One paid payment = one film credit. Creating a film uses up a credit
 * (payments.project_id is set); re-rendering and downloading that film are free.
 * Without RAZORPAY_KEY_ID/SECRET (and outside production) a "demo" mode lets you test the flow.
 */
const express = require('express');
const crypto = require('crypto');
const { getPool } = require('../db');
const { PAYMENTS, IS_PRODUCTION } = require('../config');
const { requireUser } = require('../utils/session');

const router = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const hasKeys = () => Boolean(PAYMENTS.keyId && PAYMENTS.keySecret);
const mode = () => (hasKeys() ? 'razorpay' : IS_PRODUCTION ? 'disabled' : 'demo');
const amountPaise = () => Math.round(PAYMENTS.pricePerFilm * 100);

async function razorpay(method, path, body) {
  const res = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${PAYMENTS.keyId}:${PAYMENTS.keySecret}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Razorpay: ${data?.error?.description || res.statusText}`);
  return data;
}

async function credits(userId) {
  const [[r]] = await getPool().query(
    `SELECT COUNT(*) AS n FROM payments WHERE user_id = ? AND status = 'paid' AND project_id IS NULL`, [userId]);
  return Number(r.n);
}

/** If the browser closed right after paying, pick the payment up from Razorpay. */
async function reconcile(userId) {
  if (!hasKeys()) return;
  const db = getPool();
  const [open] = await db.query(
    `SELECT id, order_id FROM payments WHERE user_id = ? AND provider = 'razorpay' AND status = 'created'
       AND created_at > NOW() - INTERVAL 2 DAY ORDER BY id DESC LIMIT 5`, [userId]);
  for (const p of open) {
    try {
      const order = await razorpay('GET', `/orders/${p.order_id}`);
      if (order.status === 'paid') {
        const pays = await razorpay('GET', `/orders/${p.order_id}/payments`);
        const ok = (pays.items || []).find((x) => x.status === 'captured' || x.status === 'authorized');
        await db.query(`UPDATE payments SET status='paid', payment_id=?, paid_at=NOW() WHERE id=? AND status='created'`,
          [ok ? ok.id : null, p.id]);
      }
    } catch (e) {
      console.warn('[payments] reconcile', p.order_id, e.message);
    }
  }
}

// Public: price shown on the home page
router.get('/price', (_req, res) => res.json({ price: PAYMENTS.pricePerFilm, currency: PAYMENTS.currency, mode: mode() }));

router.use(requireUser);

router.get('/summary', wrap(async (req, res) => {
  await reconcile(req.user.id);
  res.json({
    price: PAYMENTS.pricePerFilm,
    currency: PAYMENTS.currency,
    credits: await credits(req.user.id),
    mode: mode(),
    keyId: hasKeys() ? PAYMENTS.keyId : null,
  });
}));

router.get('/', wrap(async (req, res) => {
  const [rows] = await getPool().query(
    `SELECT p.id, p.provider, p.order_id, p.payment_id, p.amount, p.currency, p.status, p.project_id,
            p.created_at, p.paid_at, JSON_UNQUOTE(JSON_EXTRACT(pr.details, '$.address')) AS film
       FROM payments p LEFT JOIN projects pr ON pr.id = p.project_id
      WHERE p.user_id = ? AND p.status <> 'created' ORDER BY p.id DESC LIMIT 50`, [req.user.id]);
  res.json(rows.map((r) => ({ ...r, amount: r.amount / 100 })));
}));

router.post('/order', wrap(async (req, res) => {
  const m = mode();
  if (m === 'disabled') return res.status(503).json({ error: 'Payments are not configured yet.' });
  const amount = amountPaise();
  let orderId;
  if (m === 'razorpay') {
    const order = await razorpay('POST', '/orders', {
      amount,
      currency: PAYMENTS.currency,
      receipt: `film_${req.user.id}_${Date.now()}`.slice(0, 40),
      notes: { user_id: String(req.user.id), purpose: 'ESTAMOTION film' },
    });
    orderId = order.id;
  } else {
    orderId = `demo_${crypto.randomBytes(8).toString('hex')}`;
  }
  await getPool().query(
    'INSERT INTO payments (user_id, provider, order_id, amount, currency) VALUES (?,?,?,?,?)',
    [req.user.id, m, orderId, amount, PAYMENTS.currency]);

  res.json({
    mode: m,
    keyId: m === 'razorpay' ? PAYMENTS.keyId : null,
    orderId,
    amount,
    currency: PAYMENTS.currency,
    name: 'ESTAMOTION',
    description: 'Cinematic property film',
    prefill: { name: req.user.name, contact: req.user.phone },
  });
}));

router.post('/verify', wrap(async (req, res) => {
  const db = getPool();
  const orderId = String(req.body?.razorpay_order_id || '');
  const [[pay]] = await db.query('SELECT * FROM payments WHERE order_id = ? AND user_id = ?', [orderId, req.user.id]);
  if (!pay) return res.status(404).json({ error: 'Order not found.' });

  if (pay.status !== 'paid') {
    if (pay.provider === 'demo') {
      if (mode() !== 'demo') return res.status(400).json({ error: 'Demo payments are disabled.' });
    } else {
      const paymentId = String(req.body?.razorpay_payment_id || '');
      const signature = String(req.body?.razorpay_signature || '');
      const expected = crypto.createHmac('sha256', PAYMENTS.keySecret).update(`${orderId}|${paymentId}`).digest('hex');
      const valid = signature.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
      if (!valid) {
        await db.query(`UPDATE payments SET status='failed' WHERE id=? AND status='created'`, [pay.id]);
        return res.status(400).json({ error: 'Payment could not be verified. If money was deducted it will be refunded by Razorpay.' });
      }
      pay.payment_id = paymentId;
    }
    await db.query(`UPDATE payments SET status='paid', payment_id=?, paid_at=NOW() WHERE id=?`,
      [pay.payment_id || null, pay.id]);
  }
  res.json({ ok: true, credits: await credits(req.user.id) });
}));

// ---------- helpers used by the projects routes ----------

/** Use one paid credit for a new film. Returns false when the user has none. */
async function useCredit(userId, projectId) {
  const [r] = await getPool().query(
    `UPDATE payments SET project_id = ? WHERE user_id = ? AND status = 'paid' AND project_id IS NULL
      ORDER BY paid_at, id LIMIT 1`, [projectId, userId]);
  return r.affectedRows === 1;
}

/** Give the credit back if creating the film failed before it existed. */
async function returnCredit(projectId) {
  await getPool().query('UPDATE payments SET project_id = NULL WHERE project_id = ?', [projectId]);
}

module.exports = router;
module.exports.useCredit = useCredit;
module.exports.returnCredit = returnCredit;
