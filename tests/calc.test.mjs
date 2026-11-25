// node --test tests/calc.test.mjs
// 期待値はスプレッドシート「AI導入補助金_カモミール様案件共有」（2026-11-24 時点）から。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../calc.js');

// ---- シートの式そのもの（税別）----

test('シート2 の例（申請金額 税別570万円）を再現する', () => {
  for (const k of ['chusho', 'shokibo']) {
    assert.equal(C.grant(5700000, k), 3500000);
    assert.equal(C.revenueNeeded(5700000, k), 30800000);
  }
});

test('補助額：50万円の段差と 2/3 の部分', () => {
  assert.equal(C.grant(666667, 'chusho'), 500000);
  assert.equal(C.grant(625000, 'shokibo'), 500000);
  assert.equal(C.grant(4800000, 'chusho'), 3255555); // ROUNDDOWN(4,133,333×2/3)+500,000
  assert.equal(C.grant(4800000, 'shokibo'), 3283333);
  assert.equal(C.grant(5166667, 'chusho'), 3500000);
});

// 実際の案件の数字（年商など）はリポジトリに置かない。シートの実例との突き合わせは手元で確かめ済み（docs/計算の仕組み.md）。

// ---- 税込で考える ----

test('税込 → 税別：税込を超えない最大の税別額', () => {
  assert.equal(C.exclusiveOf(5280000), 4800000);
  assert.equal(C.exclusiveOf(5700000), 5181819);
  for (let x = 10000; x <= 6000000; x += 1237) {
    const a = C.exclusiveOf(x);
    assert.ok(C.taxIncluded(a) <= x && C.taxIncluded(a + 1) > x, String(x));
  }
});

test('税込528万円（税別480万円）の補助額：中小 3,255,555円／小規模 3,283,333円', () => {
  assert.equal(C.evaluateTaxIncluded(5280000, 'chusho').grant, 3255555);
  assert.equal(C.evaluateTaxIncluded(5280000, 'shokibo').grant, 3283333);
});

test('上限は税込570万円。税別 5,181,819円で、どちらの区分でも補助額 350万円に届く', () => {
  assert.equal(C.MAX_TAX_INCLUDED, 5700000);
  for (const k of ['chusho', 'shokibo']) {
    const e = C.evaluateTaxIncluded(5700000, k);
    assert.equal(e.grant, 3500000);
    assert.equal(e.burden, 2200000);
    assert.equal(e.revenueNeeded, 24500000);
    assert.equal(C.maxTaxIncluded(1e10, k), 5700000);
    assert.equal(C.maxTaxIncluded(24500000, k), 5700000);
    assert.ok(C.maxTaxIncluded(24499999, k) < 5700000);
  }
});

// 申請可能額（税込・10万円刻み）は「売上基準を満たし、10万円上げると満たさない」額
test('申請可能額は最大：条件を満たし、1刻み上は満たさない', () => {
  for (const k of ['chusho', 'shokibo']) {
    for (let rev = 0; rev <= 30000000; rev += 123457) {
      const x = C.maxTaxIncluded(rev, k);
      if (x > 0) assert.ok(C.evaluateTaxIncluded(x, k).revenueNeeded <= rev);
      if (x < C.MAX_TAX_INCLUDED) assert.ok(C.evaluateTaxIncluded(x + 100000, k).revenueNeeded > rev, `${k} ${rev}`);
    }
  }
});

test('年商からの申請可能額（税込。架空の年商）', () => {
  const want = { // 年商: [中小, 小規模]
    16000000: [3700000, 3800000],
    12000000: [2800000, 2900000],
    30000000: [5700000, 5700000],
  };
  for (const [rev, [c, s]] of Object.entries(want)) {
    assert.equal(C.maxTaxIncluded(Number(rev), 'chusho'), c);
    assert.equal(C.maxTaxIncluded(Number(rev), 'shokibo'), s);
  }
});

test('売上基準は申請額に対して単調に増える', () => {
  for (const k of ['chusho', 'shokibo']) {
    let prev = -1;
    for (let x = 10000; x <= 7000000; x += 10000) {
      const r = C.evaluateTaxIncluded(x, k).revenueNeeded;
      assert.ok(r >= prev, `${k} ${x}`);
      prev = r;
    }
  }
});

// ---- プランと代理店報酬 ----

test('プランの補助額は案内資料（中小企業）と一致する：約105/215/272/325万円', () => {
  const want = { minimum: 1055555, light: 2152525, basic: 2722222, royal: 3255555 };
  for (const p of C.PLANS) assert.equal(C.evaluateTaxIncluded(p.price, 'chusho').grant, want[p.id]);
});

test('年商（前期）→ 対象になる一番上のプラン：案内資料の表', () => {
  const want = { minimum: [8500000, 9000000], light: [17500000, 21000000], basic: [22000000, 26500000], royal: [26500000, 31500000] };
  for (const p of C.PLANS) assert.deepEqual([p.minRevenue.corp, p.minRevenue.indiv], want[p.id]);
  assert.equal(C.bestPlan(8499999, 'corp'), null);
  assert.equal(C.bestPlan(8500000, 'corp').id, 'minimum');
  assert.equal(C.bestPlan(8500000, 'indiv'), null);
  assert.equal(C.bestPlan(21000000, 'corp').id, 'light');
  assert.equal(C.bestPlan(21000000, 'indiv').id, 'light');
  assert.equal(C.bestPlan(26500000, 'corp').id, 'royal');
  assert.equal(C.bestPlan(26500000, 'indiv').id, 'basic');
  assert.equal(C.bestPlan(31500000, 'indiv').id, 'royal');
});

test('案内資料の年商は、どのプランも売上基準（自己負担 ÷ 9%）以上', () => {
  for (const p of C.PLANS) for (const k of ['chusho', 'shokibo'])
    assert.ok(p.minRevenue.corp >= C.evaluateTaxIncluded(p.price, k).revenueNeeded, p.id);
});

test('代理店報酬：① ＋ ②（その月の件数の段）', () => {
  const r = C.planById('royal');
  assert.deepEqual(C.commission(r, 1), { referral: 100000, extra: 400000, tierMin: 1, total: 500000 });
  assert.equal(C.commission(r, 4).extra, 400000);
  assert.equal(C.commission(r, 5).extra, 500000);
  assert.equal(C.commission(r, 9).extra, 500000);
  assert.equal(C.commission(r, 10).extra, 600000);
  assert.equal(C.commission(C.planById('minimum'), 10).total, 130000);
  assert.equal(C.commission(C.planById('light'), 5).total, 200000);
  assert.equal(C.commission(C.planById('basic'), 1).total, 270000);
});
