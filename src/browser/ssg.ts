import { writeFileSync, readFileSync, mkdirSync, copyFileSync, cpSync } from 'fs';
import * as path from 'path';
import config from './config.json'

import mainPage from '../shared/mainPage';

const lockfile = JSON.parse(readFileSync('./package-lock.json', 'utf-8')) as {
  packages: Record<string, { version: string }>
}
mkdirSync(config.distDir, { recursive: true });


['reset', 'vscode', 'main'].forEach(style => {
  copyFileSync(path.join(config.mediaDir, `${style}.css`), path.join(config.distDir, `${style}.css`))
});

['main', 'vscodeStub'].forEach(script => {
  copyFileSync(path.join(config.mediaDir, `${script}.js`), path.join(config.distDir, `${script}.js`))
})

copyFileSync(path.join(config.mediaDir, 'main.js'), path.join(config.distDir, 'main.js'))

cpSync(
  path.join(__dirname, '..', '..', 'out-browser', 'shared'),
  path.join(config.distDir, 'shared'),
  { recursive: true }
)

const mkUrl = (package_: string, file: string): string =>
  `https://unpkg.com/${package_}@${
    lockfile.packages['node_modules/' + package_].version
  }/${file}`;

const pageConfig = {
  styles: {
    reset: path.join(config.baseUrl, 'reset.css'),
    vscode: path.join(config.baseUrl, 'vscode.css'),
    main: path.join(config.baseUrl, 'main.css'),
    bulma: mkUrl('bulma', 'css/bulma.min.css'),
    divider: mkUrl('bulma-divider', 'dist/css/bulma-divider.min.css'),
    tooltip: mkUrl('bulma-tooltip', 'dist/css/bulma-tooltip.min.css'),
    quickview: mkUrl('bulma-quickview', 'dist/css/bulma-quickview.min.css'),
    pageloader: mkUrl('bulma-pageloader', 'dist/css/bulma-pageloader.min.css'),
    collapsible: mkUrl('@creativebulma/bulma-collapsible', 'dist/css/bulma-collapsible.min.css'),
    mdicons: mkUrl('@mdi/font', 'css/materialdesignicons.min.css')
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
    <input type="file" id="traceFileInput">
    <script>
      document.getElementById('traceFileInput')
        .addEventListener('change', event => {
          event.target.files[0].text().then(source => {
            window.postMessage({ type: 'trace', source })
          }).catch(e => console.error('Could not load file', e))
        })
    </script>
  `
});

writeFileSync(path.join(config.distDir, 'index.html'), html)
