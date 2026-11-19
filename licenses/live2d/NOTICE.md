# Zundamon and Live2D Cubism

Character © Tohoku Zunko & Zundamon Project / SSS LLC. Illustration by Sakamoto Ahiru (坂本アヒル). Cubism model and SDK by Live2D Inc. The character, model and SDK retain their respective licences. [Character guidelines](https://zunko.jp/guideline.html) · [Official model and credits](https://www.live2d.com/learn/sample/zundamon/) · [Sample model terms](https://www.live2d.com/learn/sample/model-terms/) · [Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_jp.html)

The application ships a self-contained presentation under `frontend/public/companion/`. It contains the model, texture, physics, wave motion and two expressions from the official Japanese sample. The original archive SHA-256 is `25a3bcd91a81798f81f559a086acd407d6eff5525996ce328ff4708ea23c7797`.

The Web Framework uses release `5-r.4`, commit `8df84780f2aa1298f3b30965cdae143e049f3c8e`. The Redistributable Code from the official Web Core 05 distribution has SHA-256 `25ae938cb4fe282ce189b357bcc97e603d1e1f7ec78bf04150d401c23cdc792f`. Its runtime reports Core 5.1.0. The presentation includes the upstream Core copyright and Framework licence notices. [Web Core](https://cubism.live2d.com/sdk-web/core/05/live2dcubismcore.min.js) · [Framework revision](https://github.com/Live2D/CubismWebFramework/tree/8df84780f2aa1298f3b30965cdae143e049f3c8e) · [SDK licensing](https://www.live2d.com/en/sdk/license/) · [SDK agreements](https://github.com/Live2D/CubismWebFramework/blob/8df84780f2aa1298f3b30965cdae143e049f3c8e/LICENSE.md)

## Rebuilding the presentation

Use the official model archive and Core above. Place them under `.cache/` as `zundamon_ja.zip` and `cubism-core.js`. Run these commands from the repository root with Node.js, Git and bsdtar available.

```sh
git clone --branch 5-r.4 --depth 1 https://github.com/Live2D/CubismWebFramework.git .cache/cubism-framework
npm exec --package=esbuild@0.28.2 -- esbuild frontend/scripts/companion/render.js --bundle --minify --legal-comments=inline --alias:cubism=./.cache/cubism-framework/src --outfile=.cache/companion-render.js
node frontend/scripts/companion/package.mjs .cache/zundamon_ja.zip .cache/cubism-core.js .cache/companion-render.js .cache/cubism-framework frontend/public/companion/zundamon.html
```
