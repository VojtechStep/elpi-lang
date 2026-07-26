import { writeFileSync, readFileSync, mkdirSync, copyFileSync, cpSync } from 'fs';
import * as path from 'path';

import config from './config.json' with { type: "json" }

import mainPage from '../shared/mainPage.mjs';

const lockfile = JSON.parse(readFileSync('./package-lock.json', 'utf-8')) as {
  packages: Record<string, { version: string }>
}
mkdirSync(config.distDir, { recursive: true });


['reset', 'vscode', 'main', 'vscodeStub'].forEach(style => {
  copyFileSync(path.join(config.mediaDir, `${style}.css`), path.join(config.distDir, `${style}.css`))
});

['main', 'vscodeStub'].forEach(script => {
  copyFileSync(path.join(config.mediaDir, `${script}.js`), path.join(config.distDir, `${script}.js`))
})

copyFileSync(path.join(config.mediaDir, 'main.js'), path.join(config.distDir, 'main.js'))

cpSync(
  path.join(import.meta.dirname, '../shared'),
  path.join(config.distDir, 'shared'),
  { recursive: true }
)

const mkUrl = (package_: string, file: string): string =>
  `https://unpkg.com/${package_}@${
    lockfile.packages['node_modules/' + package_]!.version
  }/${file}`;

const pageConfig = {
  styles: {
    reset: path.join(config.baseUrl, 'reset.css'),
    vscode: path.join(config.baseUrl, 'vscode.css'),
    bulma: mkUrl('bulma', 'css/bulma.min.css'),
    divider: mkUrl('bulma-divider', 'dist/css/bulma-divider.min.css'),
    tooltip: mkUrl('bulma-tooltip', 'dist/css/bulma-tooltip.min.css'),
    quickview: mkUrl('bulma-quickview', 'dist/css/bulma-quickview.min.css'),
    pageloader: mkUrl('bulma-pageloader', 'dist/css/bulma-pageloader.min.css'),
    collapsible: mkUrl('@creativebulma/bulma-collapsible', 'dist/css/bulma-collapsible.min.css'),
    mdicons: mkUrl('@mdi/font', 'css/materialdesignicons.min.css'),
    vscodeStub: path.join(config.baseUrl, 'vscodeStub.css'),
    main: path.join(config.baseUrl, 'main.css'),
  },
  scripts: {
    jquery: mkUrl('jquery', 'dist/jquery.min.js'),
    vue: mkUrl('vue', 'dist/vue.min.js'),
    fuzz: mkUrl('fuzzball', 'dist/fuzzball.umd.min.js'),
    quickview: mkUrl('bulma-quickview', 'dist/js/bulma-quickview.min.js'),
    collapsible: mkUrl('@creativebulma/bulma-collapsible', 'dist/js/bulma-collapsible.min.js'),
    vscodeStub: path.join(config.baseUrl, 'vscodeStub.js')
  },
  imports: {
    shared: path.join(config.baseUrl, 'shared')
  },
  modules: {
    main: path.join(config.baseUrl, 'main.js')
  }
}

const html = mainPage(pageConfig, body => {
  return `
    ${body}
    <input id="traceFileInput" type="file" style="position: fixed; z-index: 100; left: 80%; top: 10px">
    <script>
      // TODO: can't add event listeners on non-vue elements inside vue
      // const topBar = document.querySelector('nav');
      // const input = document.createElement('input');
      // input.type = 'file';
      // input.id = 'traceFileInput';
      // const inputContainer = document.createElement('div')
      // inputContainer.classList.add('action-buttons')
      // inputContainer.style.display = 'flex'
      // inputContainer.appendChild(input)
      // topBar.querySelector('div.action-buttons:first-child').insertAdjacentElement('afterEnd', inputContainer)
      document.getElementById('traceFileInput').addEventListener('change', event => {
        event.preventDefault()
        const file = event.target.files[0];
        file.text().then(source => {
          window.postMessage({ type: 'trace', source, file: file.name })
        }).catch(e => console.error('Could not load file', e))
      })
    </script>
  `
});

writeFileSync(path.join(config.distDir, 'index.html'), html)
