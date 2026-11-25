/*
 * AI導入補助金（インボイス枠）の申請額・補助額・売上基準の計算。
 * 元：スプレッドシート「AI導入補助金_カモミール様案件共有」シート2 の式（docs/計算の仕組み.md）。
 * 金額はすべて円の整数で扱う（浮動小数の端数ずれを避けるため）。
 */
(function (root) {
  'use strict';

  // 区分ごとの「補助額50万円に届く申請額」。50万円以下の部分の補助率から決まる。
  //   中小企業   3/4 → 500,000 ÷ 3/4 = 666,667
  //   小規模事業者 4/5 → 500,000 ÷ 4/5 = 625,000
  var KINDS = {
    chusho: { label: '中小企業',     base: 666667, lowNum: 3, lowDen: 4 },
    shokibo: { label: '小規模事業者', base: 625000, lowNum: 4, lowDen: 5 }
  };
  var LOW_GRANT = 500000;     // 補助率の高い部分の補助額
  var GRANT_CAP = 3500000;    // 補助額の上限
  var TAX_NUM = 11, TAX_DEN = 10; // 消費税 10%（補助対象外。自己負担に乗る）
  var BURDEN_RATE_DEN = 9000; // 売上基準 = 自己負担 ÷ 9% を10万円単位で切り上げ → ceil(負担 / 9,000) × 100,000
  var STEP_DEFAULT = 100000;  // 申請額の刻み（シートの実例がすべて10万円単位）
  var MAX_TAX_INCLUDED = 5700000; // 自由入力の上限（税込 570万円）。実際に売るのはプラン（下の PLANS、上限はロイヤル 528万円）

  function kindOf(k) {
    var x = KINDS[k];
    if (!x) throw new Error('区分が不明: ' + k);
    return x;
  }

  // 補助額。シート D5/D6 の式：MIN(3,500,000, ROUNDDOWN((A − base) × 2/3) + 500,000)
  // 申請額が base 未満のときシートの式は成り立たない（負の値になる）ので、
  // 低い方の補助率（3/4・4/5）をそのまま掛ける。
  function grant(amount, kind) {
    var k = kindOf(kind);
    if (amount <= 0) return 0;
    if (amount < k.base) return Math.floor(amount * k.lowNum / k.lowDen);
    var g = Math.floor((amount - k.base) * 2 / 3) + LOW_GRANT;
    return g > GRANT_CAP ? GRANT_CAP : g;
  }

  function taxIncluded(amount) {
    return Math.floor(amount * TAX_NUM / TAX_DEN);
  }

  // 自己負担（税込の支払額 − 補助額）
  function burden(amount, kind) {
    return taxIncluded(amount) - grant(amount, kind);
  }

  // 売上基準。シート C5/C6：ROUNDUP((ROUNDDOWN(A × 1.1) − 補助額) / 9 × 100, −5)
  function revenueNeeded(amount, kind) {
    var b = burden(amount, kind);
    if (b <= 0) return 0;
    return Math.ceil(b / BURDEN_RATE_DEN) * 100000;
  }

  // 補助額が上限に届く最小の申請額（刻みに切り上げ）。これより上は補助額が増えず自己負担だけ増える。
  function capAmount(kind, step) {
    step = step || STEP_DEFAULT;
    var k = kindOf(kind);
    var exact = k.base + Math.ceil((GRANT_CAP - LOW_GRANT) * 3 / 2); // 補助額が 3,500,000 に届く申請額
    return Math.ceil(exact / step) * step;
  }

  // 税込の支払額 → 税別の申請額。税込が支払額を超えない最大の税別額（floor(税別 × 1.1) ≤ 税込）。
  function exclusiveOf(taxIncl) {
    // floor(a × 1.1) ≤ x ⇔ a < 10(x+1)/11
    return Math.floor((TAX_DEN * (taxIncl + 1) - 1) / TAX_NUM);
  }

  // 税込で考えるときの1件分。支払額は入れた税込そのもの（税別から戻すと最大1円ずれるため）。
  function evaluateTaxIncluded(taxIncl, kind) {
    var amount = exclusiveOf(taxIncl);
    var g = grant(amount, kind);
    var b = taxIncl - g;
    return {
      taxIncluded: taxIncl,
      amount: amount,
      grant: g,
      burden: b,
      revenueNeeded: b <= 0 ? 0 : Math.ceil(b / BURDEN_RATE_DEN) * 100000
    };
  }

  // 年商 → 申請可能額（税込）。売上基準 ≤ 年商 を満たす最大の税込額。刻みは税込、上限は税込 570万円。
  // 自己負担は申請額に対して単調に増えるので、上から刻みで下ろせば最初に条件を満たしたものが最大。
  function maxTaxIncluded(revenue, kind, step) {
    step = step || STEP_DEFAULT;
    for (var x = Math.floor(MAX_TAX_INCLUDED / step) * step; x > 0; x -= step) {
      if (evaluateTaxIncluded(x, kind).revenueNeeded <= revenue) return x;
    }
    return 0;
  }

  // 税別のままの1件分（シート2 の式そのもの。突き合わせ用）
  function evaluate(amount, kind) {
    return {
      amount: amount,
      taxIncluded: taxIncluded(amount),
      grant: grant(amount, kind),
      burden: burden(amount, kind),
      revenueNeeded: revenueNeeded(amount, kind)
    };
  }

  // ---- プラン（hojo.camomile.co.jp と同じ4つ。税込の支払額） ----
  // ロイヤル 528万円が上限（2026-11-24 オーナー指定）。補助額は案内資料の「約105/215/272/325万円」と一致（中小企業で計算）。
  // referral = ① 紹介報酬（1件あたり・税込・補助金が満額で交付されたとき）
  // minRevenue = 対象となる年商（前期）。案内資料の表（2026-11-24 オーナー指定）。売上基準（9%）とは別に決めた額
  // extra    = ② 追加紹介報酬（1件あたり・税込）。代理店ごと・プランごとのその月の件数が min 件以上なら、その月のそのプランの全件をその段の額にする
  var PLANS = [
    { id: 'minimum', name: 'ミニマム',   price: 1650000, referral:  30000, minRevenue: { corp:  8500000, indiv:  9000000 }, extra: [[1,  50000], [5,  70000], [10, 100000]] },
    { id: 'light',   name: 'ライト',     price: 3460000, referral:  50000, minRevenue: { corp: 17500000, indiv: 21000000 }, extra: [[1, 100000], [5, 150000], [10, 200000]] },
    { id: 'basic',   name: 'ベーシック', price: 4400000, referral:  70000, minRevenue: { corp: 22000000, indiv: 26500000 }, extra: [[1, 200000], [5, 300000], [10, 400000]] },
    { id: 'royal',   name: 'ロイヤル',   price: 5280000, referral: 100000, minRevenue: { corp: 26500000, indiv: 31500000 }, extra: [[1, 400000], [5, 500000], [10, 600000]] }
  ];

  function planById(id) {
    for (var i = 0; i < PLANS.length; i++) if (PLANS[i].id === id) return PLANS[i];
    throw new Error('プランが不明: ' + id);
  }

  // 年商（前期）→ 対象になる一番上のプラン（無ければ null）。entity は 'corp'（法人）／'indiv'（個人事業主）
  function bestPlan(revenue, entity) {
    var best = null;
    PLANS.forEach(function (p) {
      if (p.minRevenue[entity] <= revenue) best = p;
    });
    return best;
  }

  // その月の件数で当たる ② の段（件数 0 以下なら 1件目の段）
  function extraTier(plan, monthCount) {
    var tier = plan.extra[0];
    plan.extra.forEach(function (t) { if (monthCount >= t[0]) tier = t; });
    return { min: tier[0], amount: tier[1] };
  }

  // 1件あたりの代理店報酬（税込）
  function commission(plan, monthCount) {
    var t = extraTier(plan, monthCount);
    return { referral: plan.referral, extra: t.amount, tierMin: t.min, total: plan.referral + t.amount };
  }

  var ENTITIES = { corp: '法人', indiv: '個人事業主' };

  var api = {
    KINDS: KINDS, GRANT_CAP: GRANT_CAP, MAX_TAX_INCLUDED: MAX_TAX_INCLUDED, STEP_DEFAULT: STEP_DEFAULT,
    grant: grant, taxIncluded: taxIncluded, burden: burden,
    revenueNeeded: revenueNeeded, capAmount: capAmount, evaluate: evaluate,
    exclusiveOf: exclusiveOf, evaluateTaxIncluded: evaluateTaxIncluded, maxTaxIncluded: maxTaxIncluded,
    ENTITIES: ENTITIES, PLANS: PLANS, planById: planById, bestPlan: bestPlan, extraTier: extraTier, commission: commission
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AGCalc = api;
})(this);
