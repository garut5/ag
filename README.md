# ag — AI導入補助金 試算

年商を入れると、申請可能額（税別）と補助額が出る社内ツール。`https://ag.camomile.co.jp`

- 計算：`calc.js`（画面とテストで共用）
- 画面：`index.html`（ビルド無し）
- 式の根拠と元のスプレッドシートとの突き合わせ：[`docs/計算の仕組み.md`](docs/計算の仕組み.md)

```bash
node --test tests/calc.test.mjs
```

出し方（Cloudflare Pages `ag`）：

```bash
rm -rf dist && mkdir dist && cp index.html calc.js dist/
npx wrangler pages deploy dist --project-name ag --branch main
```
