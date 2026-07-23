import * as vscode from 'vscode';
import * as parser_v1 from '../shared/trace_v1';
import * as parser_v2 from '../shared/trace_v2';
import mainPage from '../shared/mainPage';
import * as path from 'path';

import * as os from 'node:os';
import * as cp from 'child_process';
import * as fs from 'fs';

import * as chokidar from 'chokidar'

type TraceParser = {
    readTrace: (x: any, context?: any) => any;
};

const traceParsers: TraceParser[] = [parser_v2, parser_v1];

function any_parser_readTrace(x: any) {
    let lastError: unknown;

    for (const parser of traceParsers) {
        try {
            return parser.readTrace(x);
        } catch (error) {
            lastError = error;
        }
    }

    if (lastError instanceof Error)
        throw lastError;

    throw new Error('Failed to parse trace with all available parser versions.');
}

export class TraceProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'elpi.tracer';

    private _cat: string;
    private _elpi: string;
    private _elpi_trace_elaborator: string;
    private _options: string;
    private _options_default: string;
    private _view?: vscode.WebviewView;
    private _source: string;
    private _target: string;
    private _target_raw: string;
    private _target_dir: string;
    private _watcher: chokidar.FSWatcher | undefined;
    private _watcher_target: string;
    private _watcher_target_elaborated: string;

    private _channel: any = vscode.window.createOutputChannel('Elpi');

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) {
        
        this._channel.appendLine("Running extension for " + os.platform() + " - " + os.release());

        let elpi_lang_grammar_path = vscode.Uri.joinPath(this._extensionUri, 'syntaxes', 'elpi.tmLanguage.json').path;

        if (os.platform().toString().toLowerCase() == "win32")
            elpi_lang_grammar_path = elpi_lang_grammar_path.slice(1);
        
        this._channel.appendLine("Loading grammar file " + elpi_lang_grammar_path);

        const elpi_lang_grammer = JSON.parse(fs.readFileSync(elpi_lang_grammar_path, 'utf8'));
        const elpi_lang = {
            id: "elpi",
            scopeName: 'source.elpi',
            grammar: elpi_lang_grammer
        };

        this._elpi = "";
        this._elpi_trace_elaborator = "";

        this._options = "-test";
        this._options_default = "";

        this._source = "";
        
        if (os.platform().toString().toLowerCase() == "win32")
            this._target_dir = process.env.APPDATA + '\\';
        else
            this._target_dir = '/tmp/';

        this._target = this._target_dir + "trace.json";
        this._target_raw = this._target_dir + "trace.tmp.json";

        this._watcher_target = this._target_dir + "traced.tmp.json";
        this._watcher_target_elaborated = this._target_dir + "traced.json";

        if (os.platform().toString().toLowerCase() == "win32")
            this._cat = "type";
        else
            this._cat = "cat";
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,

            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(message => {
            switch (message.command) {

            case 'highlight':
            {
                const code = message.value;
                const indx = message.index;
                  let html = undefined;

                if (this._view)
                    this._view.webview.postMessage({
                        type: 'highlight',
                        html: html,
                        indx: indx
                    });

                break;
            }
            case 'highlight_elided':
            {
                const code = message.value;
                const indx = message.index;
                let html = undefined;
                                
                if (this._view)
                    this._view.webview.postMessage({
                        type: 'highlight_elided',
                        html: html,
                        indx: indx
                    });
    
                break;
            }
            case 'highlight_inline':
            {
                const code = message.value;
                const id = message.id;
                let html = undefined;
                                
                if (this._view)
                    this._view.webview.postMessage({
                        type: 'highlight_inline',
                        html: html,
                        id: id
                    });
    
                break;
            }
            case 'notify':
            {
                vscode.window.showInformationMessage(message.value);

                break;
            }
            case 'hopTo':
            {
                if (!message.value.startsWith('builtin')) {

                    const file = message.value.split(' ')[0];
                    const position = message.value.split(' ')[1];
                    // const character = position.substring(
                    //     position.indexOf("(") + 1,
                    //     position.lastIndexOf("@")
                    // );
                    const line = position.substring(
                        position.indexOf("L") + 1,
                        position.lastIndexOf(":")
                    );
                    const column = position.substring(
                        position.indexOf("C") + 1,
                        position.lastIndexOf(")")
                    );

                    let openPath = file;

                    vscode.workspace.openTextDocument(openPath).then(async (doc) => {
                        let pos1 = new vscode.Position(0, 0);
                        let pos2 = new vscode.Position(0, 0);
                        let sel = new vscode.Selection(pos1, pos2);
                        vscode.window.showTextDocument(doc, vscode.ViewColumn.One).then((e) => {
                            e.selection = sel;
                            vscode.commands
                                .executeCommand("cursorMove", {
                                    to: "down",
                                    by: "line",
                                    value: parseInt(line) - 1,
                                })
                                .then(() =>
                                    vscode.commands.executeCommand("cursorMove", {
                                        to: "right",
                                        by: "character",
                                        value: parseInt(column) - 1,
                                    })
                                );
                        });
                    });

                    this._channel.appendLine(`Hoping to file ${file} at ${line}:${column}`);
                }

                break;
            }
            case 'options_changed':
            {
                this._options = message.value;
                this._channel.appendLine(`Options changed to: ${this._options}`);
                break;
            }
            default:
                break;
            }
        });
    }

    private findFileOnPath(name: string) {
        if (name.startsWith('/')) { return true };

        const paths = (process.env.PATH || '')
          .split(path.delimiter)
          .map(x => path.resolve(x, name));
        
        for (const p of paths) {
          if (fs.existsSync(p)) {
            return true;
          }
        }
        return false;
      }

    private exec(command: string) {

        let result = cp.execSync(command).toString();

        if (result == "")
            result = "OK.";

        this._channel.appendLine(command + ": " + result);
    }

    public clear() {

        if (this._view)
            this._view.webview.postMessage({ type: 'clear' });
    }

    public open() {
        const options: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: 'Open trace',
            canSelectFiles: true,
            canSelectFolders: false
        };
       
        vscode.window.showOpenDialog(options).then(fileUri => {
            if (fileUri && fileUri[0]) {

                let configuration = vscode.workspace.getConfiguration('elpi');
        
                this._elpi_trace_elaborator = configuration.elpi_trace_elaborator.path;

				if(!this.findFileOnPath(this._elpi_trace_elaborator)) {
					vscode.window
					  .showInformationMessage(`Failed to find elpi trace elaborator`, 'Go to settings')
					  .then(action => {
						if (action == 'Go to settings')
							vscode.commands.executeCommand('workbench.action.openSettings', '@ext:gares.elpi-lang');
					});
					return;
				}

                this._channel.appendLine("Opening raw trace: " + fileUri[0].fsPath);

                if (this._view)
                    this._view.webview.postMessage({ type: 'progress', state: 'on' });

                // this.exec(this._cat + " " + fileUri[0].fsPath + " | " + this._elpi_trace_elaborator + " > " + this._target);
// 
                const input = fs.readFileSync(fileUri[0].fsPath, 'utf-8');

                // const trace = any_parser_readTrace(JSON.parse(fs.readFileSync(this._target, 'utf8')));
// 
                this._source = fileUri[0].fsPath;

                if (this._view)
                    this._view.webview.postMessage({ type: 'trace', source: input });
                
                if (this._view)
                    this._view.webview.postMessage({ type: 'progress', state: 'off' });
            }
        });
    }

    public save() {
        const options: vscode.SaveDialogOptions = {
            saveLabel: 'Save raw trace as'
        };
       
        vscode.window.showSaveDialog(options).then(fileUri => {
            if (fileUri) {
                this._channel.appendLine("Saving trace as: " + fileUri.toString() + " from " + this._source);

                fs.copyFile(this._source, fileUri.toString().slice(7), (err) => { // slice(7) chops 'file://'
                    if (err) {
                        this._channel.appendLine("Error saving raw trace to " + fileUri.toString().slice(7) + " " + err.toString());
                    } else {
                        this._channel.appendLine("Raw trace saved to " + fileUri.toString().slice(7)); 
                    }
                });
            }
        });
    }

    public watch_start() {

        let message;

        this._watcher = chokidar.watch(this._watcher_target, {
            persistent: true,
            ignoreInitial: true
        });

        if (this._view)
            this._view.webview.postMessage({ type: 'watcher', status: 'on' });

        this._watcher.on('change', path => {

            let configuration = vscode.workspace.getConfiguration('elpi');
                    
            this._elpi                  = configuration.elpi.path;
            this._elpi_trace_elaborator = configuration.elpi_trace_elaborator.path;

			if(!this.findFileOnPath(this._elpi)) {
				vscode.window
				  .showInformationMessage(`Failed to find elpi`, 'Go to settings')
				  .then(action => {
					if (action == 'Go to settings')
						vscode.commands.executeCommand('workbench.action.openSettings', '@ext:gares.elpi-lang');
				});
				return;
			}

			if(!this.findFileOnPath(this._elpi_trace_elaborator)) {
				vscode.window
				  .showInformationMessage(`Failed to find elpi trace elaborator`, 'Go to settings')
				  .then(action => {
					if (action == 'Go to settings')
						vscode.commands.executeCommand('workbench.action.openSettings', '@ext:gares.elpi-lang');
				});
				return;
			}

            message = `File ${path} has been changed`;

            vscode.window.showInformationMessage(message);

            this._channel.appendLine(message);

            this.exec("eval $(opam env) && cat " + this._watcher_target + " | " + this._elpi_trace_elaborator + " > " + this._watcher_target_elaborated);

            const trace = any_parser_readTrace(JSON.parse(fs.readFileSync(this._watcher_target_elaborated, 'utf8')));

            this._source = this._watcher_target;

            if (this._view)
                this._view.webview.postMessage({ type: 'trace', trace: trace, file: 'Watched' });
        });

        message = "Me watch has started. Try me by touching " + this._watcher_target;

        vscode.window.showInformationMessage(message);

        this._channel.appendLine(message);
    }

    public watch_stop() {

        if (this._watcher != undefined
         && this._view    != undefined) {

            this._watcher.close().then(() => {

                const message = "Me watch has ended.";

                vscode.window.showInformationMessage(message);
                
                this._channel.appendLine(message);

                if (this._view)
                    this._view.webview.postMessage({ type: 'watcher', status: 'off' });
            });
        }
    }

    public trace() {

        let configuration = vscode.workspace.getConfiguration('elpi');
        let current_file = '';
        
        this._elpi                  = configuration.elpi.path;
        this._elpi_trace_elaborator = configuration.elpi_trace_elaborator.path;

		if(!this.findFileOnPath(this._elpi)) {
			vscode.window
			  .showInformationMessage(`Failed to find elpi`, 'Go to settings')
			  .then(action => {
				if (action == 'Go to settings')
					vscode.commands.executeCommand('workbench.action.openSettings', '@ext:gares.elpi-lang');
			});
			return;
		}

		if(!this.findFileOnPath(this._elpi_trace_elaborator)) {
			vscode.window
			  .showInformationMessage(`Failed to find elpi trace elaborator`, 'Go to settings')
			  .then(action => {
			    if (action == 'Go to settings')
					vscode.commands.executeCommand('workbench.action.openSettings', '@ext:gares.elpi-lang');
		    });
			return;
		}

        this._options_default = configuration.elpi.options;

        if(vscode.window.activeTextEditor == undefined)
            return;

        current_file = vscode.window.activeTextEditor.document.fileName;
        vscode.window.showInformationMessage(`Tracing: ${current_file}`);
        
        this._channel.appendLine("Trace started: " + current_file);

        // --

        if(os.platform().toString().toLowerCase() == "win32")
            this.exec('cd ' + this._target_dir);

        // this.exec("eval $(opam env) && " + this._elpi + " " + this._options + " " + this._options_default + " " + current_file);
        this.exec(this._elpi + " " + this._options + " " + this._options_default.replace('[OUTPUT]', this._target_raw) + " " + current_file);
            
        // cp.execSync(this._elpi + " " + this._options + " " + this._options_default + " " + current_file);
        
        this.exec(this._cat + " " + this._target_raw + " | " + this._elpi_trace_elaborator + " > " + this._target);
        
        // --

        if(!fs.existsSync(this._target)) {
            vscode.window.showInformationMessage(`Trace generation failed`);
            this._channel.appendLine("Trace generation failed.");
            return;
        } else {
            this._channel.appendLine("Trace generation successful.");
        }

        // --

        this._source = this._target_raw;

        // --

        const trace = any_parser_readTrace(JSON.parse(fs.readFileSync(this._target, 'utf8')))

        // --- Send message to the view backend

        if (this._view)
            this._view.webview.postMessage({ type: 'trace', trace: trace, file: current_file });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {

        const      jqueryUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'jquery', 'dist', 'jquery.min.js'));
        const         vueUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'vue', 'dist', 'vue.min.js'));
        const        fuzzUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'fuzzball', 'dist', 'fuzzball.umd.min.js'));
        const     bulmaQVUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'bulma-quickview', 'dist', 'js', 'bulma-quickview.min.js'));
        const     bulmaACUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@creativebulma', 'bulma-collapsible', 'dist', 'js', 'bulma-collapsible.min.js'));
        const      scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const      sharedUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out-browser', 'shared'));

        const    styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'reset.css'));
        const   styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
        const    styleBulmaUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'bulma', 'css', 'bulma.min.css'));
        const  styleBulmaDVUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'bulma-divider', 'dist', 'css', 'bulma-divider.min.css'));
        const  styleBulmaTTUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'bulma-tooltip', 'dist', 'css', 'bulma-tooltip.min.css'));
        const  styleBulmaQVUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'bulma-quickview', 'dist', 'css', 'bulma-quickview.min.css'));
        const  styleBulmaPLUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', 'bulma-pageloader', 'dist', 'css', 'bulma-pageloader.min.css'));
        const  styleBulmaACUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@creativebulma', 'bulma-collapsible', 'dist', 'css', 'bulma-collapsible.min.css'));
        const      styleMDIUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@mdi', 'font', 'css', 'materialdesignicons.min.css'));
        const     styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

      return mainPage({
        styles: {
          reset: styleResetUri.toString(),
          vscode: styleVSCodeUri.toString(),
          bulma: styleBulmaUri.toString(),
          divider: styleBulmaDVUri.toString(),
          tooltip: styleBulmaTTUri.toString(),
          quickview: styleBulmaQVUri.toString(),
          pageloader: styleBulmaPLUri.toString(),
          collapsible: styleBulmaACUri.toString(),
          mdicons: styleMDIUri.toString(),
          main: styleMainUri.toString(),
        },
        scripts: {
          jquery: jqueryUri.toString(),
          vue: vueUri.toString(),
          fuzz: fuzzUri.toString(),
          quickview: bulmaQVUri.toString(),
          collapsible: bulmaACUri.toString(),
        },
        imports: {
          shared: sharedUri.toString()
        },
        modules: {
          main: scriptUri.toString()
        }
      }, b => b);
    }
}
