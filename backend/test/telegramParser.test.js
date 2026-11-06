/**
 * PLAN-12: parser of the owner's Notes format (pure, no DB).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseLine, parseMessage, formatOrderLine } = require('../services/telegramParser');

/**
 * Picks the business fields of a parsed order line.
 * @param {object} p
 * @returns {object}
 */
const fields = (p) => ({ id: p.id, name: p.name, qty: p.qty, pay: p.pay, delivered: p.delivered, encargo: p.encargo, phone: p.phone });

const NOTA = `Tanda prueba:
  Elías: 4. Por entregar. Pagado.
  Bryan Toloza: 2. Pendiente pago. Por entregar.
  Leonel Landaeta: 3. Pendiente de pago.
  Elvis Pacheco: 1. Pagada. Entregada.`;

test('P1: encabezado «Tanda prueba:» se reconoce como encabezado', () => {
  assert.deepEqual(parseLine('Tanda prueba:'), { kind: 'header', name: 'Tanda prueba' });
});

test('P2–P5: las cuatro líneas del ejemplo, con estados en cualquier orden', () => {
  assert.deepEqual(fields(parseLine('  Elías: 4. Por entregar. Pagado.')),
    { id: null, name: 'Elías', qty: 4, pay: 'pagado', delivered: false, encargo: false, phone: null });
  assert.deepEqual(fields(parseLine('  Bryan Toloza: 2. Pendiente pago. Por entregar.')),
    { id: null, name: 'Bryan Toloza', qty: 2, pay: 'pendiente_pago', delivered: false, encargo: false, phone: null });
  // Sin estado de entrega: queda null (el bot lo registra "por entregar").
  assert.deepEqual(fields(parseLine('  Leonel Landaeta: 3. Pendiente de pago.')),
    { id: null, name: 'Leonel Landaeta', qty: 3, pay: 'pendiente_pago', delivered: null, encargo: false, phone: null });
  assert.deepEqual(fields(parseLine('  Elvis Pacheco: 1. Pagada. Entregada.')),
    { id: null, name: 'Elvis Pacheco', qty: 1, pay: 'pagado', delivered: true, encargo: false, phone: null });
});

test('P6: el bloque completo pegado como un solo mensaje', () => {
  const lines = parseMessage(NOTA);
  assert.deepEqual(lines.map((l) => l.kind), ['header', 'order', 'order', 'order', 'order']);
  assert.deepEqual(lines.map((l) => l.n), [1, 2, 3, 4, 5]);
  assert.deepEqual(lines.slice(1).map((l) => l.qty), [4, 2, 3, 1]);
});

test('P7: un solo pedido en una línea', () => {
  const lines = parseMessage('Elías: 4. Pagado.');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].kind, 'order');
  assert.equal(lines[0].name, 'Elías');
});

test('variantes de mayúsculas, tildes y separadores', () => {
  const casos = [
    ['elias: 4. PAGADO. ENTREGADO', 'pagado', true],
    ['Elías: 4, pagada, entregada', 'pagado', true],
    ['Elías: 4; Pendiente De Pago; POR ENTREGAR', 'pendiente_pago', false],
    ['Elías: 4. pendiente. por entregar', 'pendiente_pago', false],
    ['Elías: 4 hallacas. Cortesía.', 'cortesia', null],
    ['Elías: 4. CORTESIA', 'cortesia', null],
    ['- Elías: 4. Pagado.', 'pagado', null],
    ['• Elías: 4. Pagado.', 'pagado', null],
  ];
  for (const [line, pay, delivered] of casos) {
    const p = parseLine(line);
    assert.equal(p.kind, 'order', line);
    assert.equal(p.qty, 4, line);
    assert.equal(p.pay, pay, line);
    assert.equal(p.delivered, delivered, line);
  }
});

test('"pendiente pago" no se confunde con pagado ni "por entregar" con entregado', () => {
  assert.equal(parseLine('X: 1. Pendiente pago.').pay, 'pendiente_pago');
  assert.equal(parseLine('X: 1. Por entregar.').delivered, false);
});

test('teléfono opcional: se reconoce y no se toma como cantidad', () => {
  const p = parseLine('Ana: 2. Pagado. 912345678');
  assert.equal(p.qty, 2);
  assert.equal(p.phone, '+56912345678');
  assert.equal(parseLine('Ana: 2. +56 9 1234 5678').phone, '+56912345678');
  assert.equal(parseLine('Ana: 2. Pagado.').phone, null);
});

test('encargo y #ID', () => {
  const e = parseLine('Ana: 30. Encargo.');
  assert.equal(e.encargo, true);
  assert.equal(e.qty, 30);
  const u = parseLine('#12: Pagado. Entregado.');
  assert.deepEqual(fields(u), { id: 12, name: null, qty: null, pay: 'pagado', delivered: true, encargo: false, phone: null });
  assert.equal(parseLine('#12 Elías: 4. Pagado.').name, 'Elías');
});

test('líneas inválidas: se señalan, no se adivina', () => {
  const casos = [
    ['Elías 4 pagado', /Nombre: cantidad/],
    ['Elías: Pagado.', /falta la cantidad/],
    [': 4. Pagado.', /falta el nombre/],
    ['Elías: 4. Pagadito.', /no entiendo «pagadito»/],
    ['Elías: 4. Pagado. Pendiente de pago.', /contradictorios/],
    ['Elías: 4. Entregado. Por entregar.', /contradictorios/],
    ['Elías: 4. 5.', /contradictorios/],
    ['Elías: 0.', /fuera de rango/],
    ['Elías: 20000.', /fuera de rango/],
    ['Elías: 4. 12345.', /no entiendo|contradictorios/],
    ['Ana: 30. Encargo. Entregado.', /encargo no puede/],
    ['#12:', /nada que cambiar/],
    ['Elías: -4.', /no entiendo/],
  ];
  for (const [line, re] of casos) {
    const p = parseLine(line);
    assert.equal(p.kind, 'error', line);
    assert.match(p.reason, re, line);
  }
});

test('ida y vuelta: formatOrderLine se vuelve a parsear con los mismos datos', () => {
  const rows = [
    { id: 7, customer_name: 'Elías', quantity_hallacas: 4, status: 'pagado', delivered_at: null, stock_exempt: 0 },
    { id: 8, customer_name: 'Bryan Toloza', quantity_hallacas: 2, status: 'pendiente_pago', delivered_at: '2026-11-06 10:00:00', stock_exempt: 0 },
    { id: 9, customer_name: 'Ana', quantity_hallacas: 30, status: 'cortesia', delivered_at: null, stock_exempt: 1 },
  ];
  for (const o of rows) {
    const p = parseLine(formatOrderLine(o));
    assert.equal(p.kind, 'order', formatOrderLine(o));
    assert.equal(p.id, o.id);
    assert.equal(p.name, o.customer_name);
    assert.equal(p.qty, o.quantity_hallacas);
    assert.equal(p.pay, o.status);
    assert.equal(p.delivered, Boolean(o.delivered_at));
    assert.equal(p.encargo, o.stock_exempt === 1);
  }
});
