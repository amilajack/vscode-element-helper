import {
    window,
    commands,
    ViewColumn,
    Disposable,
    Event,
    Uri,
    CancellationToken,
    TextDocumentContentProvider,
    EventEmitter,
    workspace,
    CompletionItemProvider,
    ProviderResult,
    TextDocument,
    Position,
    CompletionItem,
    CompletionList,
    CompletionItemKind,
    SnippetString,
    Range
} from 'vscode';
import Resource from './resource';
import * as TAGS from 'element-helper-json/element-tags.json';
import * as ATTRS from 'element-helper-json/element-attributes.json';

const prettyHTML = require('pretty');
const Path = require('path');
const fs = require('fs');

export const SCHEME = 'element-helper';

const WORD_REG = /(-?\d*\.\d\w*)|([^\`\~\!\@\$\^\&\*\(\)\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\s]+)/gi;

export interface Query {
    keyword: string
};

export interface TagObject{
  text: string,
  offset: number
};

export function encodeDocsUri(query?: Query): Uri {
    return Uri.parse(`${SCHEME}://search?${JSON.stringify(query)}`);
}

export function decodeDocsUri(uri: Uri): Query {
    return <Query>JSON.parse(uri.query);
}

export class App {
  private _disposable: Disposable;

  getSeletedText() {
    let editor = window.activeTextEditor;

    if (!editor) {return;}

    let selection = editor.selection;

    if (selection.isEmpty) {
      let text = [];
      let range = editor.document.getWordRangeAtPosition(selection.start, WORD_REG);

      return editor.document.getText(range);
    } else {
      return editor.document.getText(selection);
    }
  }

  setConfig() {
    // https://github.com/Microsoft/vscode/issues/24464
    const config = workspace.getConfiguration('editor');
    const quickSuggestions = config.get('quickSuggestions');
    if(!quickSuggestions["strings"]) {
      config.update("quickSuggestions", { "string": true }, true);
    }
  }

  openHtml(uri: Uri, title) {
    return commands.executeCommand('vscode.previewHtml', uri, ViewColumn.Two, title)
      .then((success) => {
      }, (reason) => {
          window.showErrorMessage(reason);
      });
  }

  openDocs(query?: Query, title = 'Element-helper', editor = window.activeTextEditor){
    this.openHtml(encodeDocsUri(query), title)
  }
        
  dispose() {
    this._disposable.dispose();
  }
}

const HTML_CONTENT = (query: Query) => {
  const config = workspace.getConfiguration('element-helper');
  const language = <string>config.get('language');
  const version = config.get('version');
  const path = query.keyword;
  const style = fs.readFileSync(Path.join(Resource.RESOURCE_PATH, 'style.css'), 'utf-8');
  
  const componentPath = `${version}/main.html#/${language}/component/${path}`;
  const href = Resource.ELEMENT_HOME_URL + componentPath.replace('main.html', 'index.html');
  const iframeSrc = Path.join(Resource.ELEMENT_PATH, componentPath);

  const notice = ({
    'zh-CN': `版本：${version}，在线示例请在浏览器中<a href="${href}">查看</a>`,
    'en-US': `Version: ${version}, view online examples in <a href="${href}">browser</a>`
  })[language];

  return `
    <style type="text/css">${style}</style>
    <body class="element-helper-docs-container">
    <div class="element-helper-move-mask"></div>
    <div class="element-helper-loading-mask">
      <div class="element-helper-loading-spinner">
        <svg viewBox="25 25 50 50" class="circular">
          <circle cx="50" cy="50" r="20" fill="none" class="path"></circle>
        </svg>
      </div>
    </div>
    <div class="docs-notice">${notice}</div>
    <iframe id="doc-frame" src="file://${iframeSrc}"></iframe>
    <script>
      window.addEventListener('message', (e) => {
        e.data.loaded && (document.querySelector('.element-helper-loading-mask').style.display = 'none');
      }, false);
    </script>
    </body>`;
};

export class ElementDocsContentProvider implements TextDocumentContentProvider {
    private _onDidChange = new EventEmitter<Uri>();

    get onDidChange(): Event<Uri> {
      return this._onDidChange.event;
    }

    public update(uri: Uri) {
      this._onDidChange.fire(uri);
    }

    provideTextDocumentContent(uri: Uri, token: CancellationToken): string | Thenable<string> {
      return HTML_CONTENT(decodeDocsUri(uri));
    }
}

export class ElementCompletionItemProvider implements CompletionItemProvider {
  private _document: TextDocument;
  private _position: Position;
  private tagReg: RegExp = /<([\w-]+)\s*/g;
  private attrReg: RegExp = /\s*(\w+)\s*=\s*"[^"]*/;

  getPreTag(): TagObject | undefined {
    let line = this._position.line;
    let tag: TagObject | string;
    let txt = this.getTextBeforePosition(this._position);
  
    while (this._position.line - line < 10 && line) {
      if (line !== this._position.line) {
        txt = this._document.lineAt(line).text;
      }
      tag = this.matchTag(this.tagReg, txt, line);
      
      if (tag === 'break') return;
      if (tag) return <TagObject>tag;
      line--;
    }
    return;
  }

  getPreAttr(): string | undefined {
    let txt = this.getTextBeforePosition(this._position).replace(/"[^'"]*(\s*)[^'"]*$/, '');
    let end = this._position.character;
    let start = txt.lastIndexOf(' ', end) + 1;
    let parsedTxt = this._document.getText(new Range(this._position.line, start, this._position.line, end));

    return this.matchAttr(this.attrReg, parsedTxt);
  }

  matchAttr(reg: RegExp, txt: string): string {
    let match: RegExpExecArray;
    match = reg.exec(txt);
    return !/"[^"]*"/.test(txt) && match && match[1];
  }

  matchTag(reg: RegExp, txt: string, line: number): TagObject | string {
    let match: RegExpExecArray;
    let arr: TagObject[] = [];
    if (/<\/?[-\w]+[^<>]*>[\s\w]*<?\s*[\w-]*$/.test(txt) || (this._position.line === line && /^\s*[^<]+\s*>[^<\/>]*$/.test(txt))) {
      return 'break';
    }
    while((match = reg.exec(txt))) {
      arr.push({
        text: match[1],
        offset: this._document.offsetAt(new Position(line, match.index))
      });
    }
    return arr.pop();
  }

  getTextBeforePosition(position: Position): string {
    var start = new Position(position.line, 0);
    var range = new Range(start, position);
    return this._document.getText(range);
  }
  getTagSuggestion() {
    let suggestions = [];

    for (let tag in TAGS) {
      suggestions.push(this.buildTagSuggestion(tag, TAGS[tag]));
    }
    return suggestions;
  }

  getAttrValueSuggestion(tag: string, attr: string): CompletionItem[] {
    let suggestions = [];
    const values = this.getAttrValues(tag, attr);
    values.forEach(value => {
      suggestions.push({
        label: value,
        kind: CompletionItemKind.Value
      });
    });
    return suggestions;
  }

  getAttrSuggestion(tag: string) {
    let suggestions = [];
    let tagAttrs = this.getTagAttrs(tag);
    let preText = this.getTextBeforePosition(this._position);
    let prefix = preText.split(/\s+/).pop();
    // method attribute
    const method = prefix[0] === '@';
    // bind attribute
    const bind = prefix[0] === ':';

    prefix = prefix.replace(/[:@]/, '');

    if(/[^@:a-zA-z\s]/.test(prefix[0])) {
      return suggestions;
    }

    tagAttrs.forEach(attr => {
      const attrItem = this.getAttrItem(tag, attr);
      if (attrItem && (!prefix.trim() || this.firstCharsEqual(attr, prefix))) {
          const sug = this.buildAttrSuggestion({attr, tag, bind, method}, attrItem);
          sug && suggestions.push(sug);
      }
    });
    for (let attr in ATTRS) {
      const attrItem = this.getAttrItem(tag, attr);
      if (attrItem && attrItem.global && (!prefix.trim() || this.firstCharsEqual(attr, prefix))) {
        const sug = this.buildAttrSuggestion({attr, tag: null, bind, method}, attrItem);
        sug && suggestions.push(sug);
      }
    }
    return suggestions;
  }

  buildTagSuggestion(tag, tagVal) {
    const snippets = [];
    let index = 0;
    function build(tag, {subtags, defaults}, snippets) {
      let attrs = '';
      defaults && defaults.forEach((item,i) => {
        attrs +=` ${item}="$${index + i + 1}"`;
      });
      snippets.push(`${index > 0 ? '<':''}${tag}${attrs}>`);
      index++;
      subtags && subtags.forEach(item => build(item, TAGS[item], snippets));
      snippets.push(`</${tag}>`);
    };
    build(tag, tagVal, snippets);

    return {
      label: tag,
      insertText: new SnippetString(prettyHTML('<' + snippets.join('')).substr(1)),
      kind: CompletionItemKind.Snippet,
      detail: 'element-ui',
      documentation: tagVal.description
    };
  }

  buildAttrSuggestion({attr, tag, bind, method}, {description, type}) {
    if ((method && type === "method") || (bind && type !== "method") || (!method && !bind)) {
      return {
        label: attr,
        insertText: (type && (type === 'flag')) ? `${attr} ` : new SnippetString(`${attr}=\"$1\"$0`),
        kind: (type && (type === 'method')) ? CompletionItemKind.Method : CompletionItemKind.Property,
        detail:  tag ?  `<${tag}>` : 'element-ui',
        documentation: description
      };
    } else { return; }
  }

  getAttrValues(tag, attr) {
    let attrItem = this.getAttrItem(tag, attr);
    let options = attrItem && attrItem.options;
    if (!options && attrItem) {
      if (attrItem.type === 'boolean') {
        options = ['true', 'false'];
      } else if (attrItem.type === 'icon') {
        options = ATTRS['icons'];
      } else if (attrItem.type === 'shortcut-icon') {
        options = [];
        ATTRS['icons'].forEach(icon => {
          options.push(icon.replace(/^el-icon-/, ''));
        });
      }
    }
    return options || [];
  }

  getTagAttrs(tag: string) {
    return (TAGS[tag] && TAGS[tag].attributes) || [];
  }

  getAttrItem(tag: string | undefined, attr: string | undefined) {
    return ATTRS[`${tag}/${attr}`] || ATTRS[attr];
  }

  isAttrValueStart(tag: Object | undefined, attr) {
    return tag && attr;
  }

  isAttrStart(tag: TagObject | undefined) {
    return tag;
  }

  isTagStart() {
    let preChar = this._document.getText(new Range(this._position.translate(0, -1), this._position));

    return preChar === '<';
  }

  firstCharsEqual(str1: string, str2: string) {
    if (str2 && str1) {
      return str1[0].toLowerCase() === str2[0].toLowerCase();
    }
    return false;
  }
  // tentative plan for vue file
  notInTemplate(): boolean {
    let line = this._position.line;
    while(line) {
      if (/^\s*<script.*>\s*$/.test(<string>this._document.lineAt(line).text)) {
        return true;
      }
      line--;
    }
    return false;
  }

  provideCompletionItems(document: TextDocument, position: Position, token: CancellationToken): ProviderResult<CompletionItem[] | CompletionList> {
    this._document = document;
    this._position = position;
    let tag: TagObject | string | undefined = this.getPreTag();
    let attr = this.getPreAttr();

    // console.log('tag: ', JSON.stringify(tag), 'attr:', attr);
    
    if (this.isAttrValueStart(tag, attr)) {
      return this.getAttrValueSuggestion(tag.text, attr);
    } else if(this.isAttrStart(tag)) {
      return this.getAttrSuggestion(tag.text);
    } else if (this.isTagStart() && !this.notInTemplate()) {
      switch(document.languageId) {
        case 'vue':
          return this.notInTemplate() ? [] : this.getTagSuggestion();
        case 'html':
          // todo
          return this.getTagSuggestion();
      }
    } else { return []; }
  }
  // resolveCompletionItem(item: CompletionItem, token: CancellationToken): ProviderResult<CompletionItem> {
  //   console.log('item', item);
  //   console.log(this._pos);
  //   console.log(this._doc.getWordRangeAtPosition(this._pos));
  //   return {
  //     label: 'ddddd'
  //   };
  // }
}