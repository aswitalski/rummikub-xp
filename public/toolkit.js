/*
Copyright 2017-2020 Opera Software AS

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

     http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

{
  const isBrowser = 'object' === typeof window;
  const $global = isBrowser ? window : global;

  class Module {

    constructor(id, isRequired) {
      this.id = id;
      this.isRequired = isRequired;

      this.exports = null;
      this.dependencies = new Set();
      this.clients = new Set();
    }

    /*
     * Returns a set of all module's dependencies.
     */
    get deepDependencies() {
      const deps = new Set();
      const collect = module => {
        for (const dependency of module.dependencies) {
          if (!deps.has(dependency)) {
            deps.add(dependency);
            collect(dependency);
          }
        }
      };
      collect(this);
      return deps;
    }
  }

  class Context {

    constructor() {
      this.stack = [];
    }

    /*
     * Pushes the module onto the stack.
     */
    save(module) {
      this.stack.push(module);
    }

    /*
     * Restores the stack to the previous state.
     */
    restore(module) {
      const lastModule = this.stack.pop();
      if (lastModule !== module) {
        throw new Error(
            `Invalid context detected: '${
                                          lastModule.id
                                        }', expecting: ${module.id}`);
      }
    }

    /*
     * Returns the last module from the stack.
     */
    get module() {
      return this.stack[this.stack.length - 1] || null;
    }

    /*
     * Adds the specified dependency to the current module.
     */
    registerDependencyTo(dependency, required = false) {
      if (this.module) {
        this.module.dependencies.add(dependency);
        dependency.clients.add(this.module);
      }
    }
  }

  /* Mapping of ids to promises of exported values. */
  const exportPromises = new Map();

  /* Mapping of ids to promises of loaded modules. */
  const loadPromises = new Map();

  class Loader {

    constructor() {
      this.ready = Promise.resolve(null);
      this.context = new Context();
      this.registry = new Map();
    }

    /*
     * Makes the loader use the specified plugin.
     */
    use(plugin) {
      console.assert(
          plugin.constructor === Object, 'Plugin must be a plain object!');
      Object.setPrototypeOf(plugin, loader);
      return $global.loader = plugin;
    }

    /*
     * Declares that module resolved by given id
     * is an optional dependency.
     *
     * Returns a symbol for the specified id.
     */
    symbol(id) {
      let module = this.registry.get(id);
      if (!module) {
        module = this.registerModule(id);
      }
      this.context.registerDependencyTo(module);
      return Symbol.for(id);
    }

    /*
     * Finds a module by the specified id and declares it
     * to be a required dependency.
     *
     * Returns module's exported value.
     */
    async require(id) {
      let module = this.registry.get(id);
      if (module) {
        if (!module.isRequired) {
          module.isRequired = true;
        }
      } else {
        module = this.registerModule(id, true);
      }
      this.context.registerDependencyTo(module);
      return await this.resolve(id);
    }

    /*
     * Finds a module by the specified id.
     *
     * Returns module's exported value.
     */
    async resolve(id) {
      let module = this.registry.get(id);
      if (module) {
        if (module.exports) {
          return module.exports;
        }
        if (module.isPending) {
          return exportPromises.get(id);
        }
      } else {
        module = this.registerModule(id);
      }
      return await this.load(module);
    }

    /*
     * Defines the exported value for the module with the specified id.
     * If the module does not exist, creates a new one.
     */
    define(id, exported) {
      const module = this.registry.get(id) || this.registerModule(id);
      if (!module.exports) {
        module.exports = exported;
        this.registry.set(id, module);
      }
      return module;
    }

    /*
     * Gets the module from the cache and returns its exported value.
     * Returns null if the module is not found.
     */
    get(id) {
      const module = this.registry.get(id);
      return module ? module.exports : null;
    }

    /*
     * Preloads the module with given id and preloads recursively
     * all the dependencies. Returns module's exported value.
     */
    async preload(id) {

      let loadPromise = loadPromises.get(id);
      if (loadPromise) {
        return loadPromise;
      }

      const done = await this.waitForLoader();

      const module = this.registry.get(id);
      if (module && module.isLoaded) {
        return module.exports;
      }

      loadPromise = this.loadWithDependencies(id);
      loadPromises.set(id, loadPromise);

      const exported = await loadPromise;
      done();
      return exported;
    }

    /*
     * Waits for the loader to be ready.
     * Returns the "done" function to release loader for the subsequent calls.
     */
    async waitForLoader() {
      const loaderReady = this.ready;
      let done;
      const donePromise = new Promise(resolve => {
        done = resolve;
      });
      this.ready = donePromise;

      await loaderReady;
      return done;
    }

    /*
     * Loads the module with given id with all its dependencies.
     * Returns module's exported value.
     */
    async loadWithDependencies(id) {
      const exported = await this.resolve(id);
      const module = this.registry.get(id);
      for (const dependency of module.dependencies) {
        if (!dependency.exports) {
          await this.loadWithDependencies(dependency.id);
        }
      }
      module.isLoaded = true;
      return exported;
    }

    /*
     * Loads and initializes the module. Returns its exported value.
     */
    async load(module) {

      const id = module.id;
      const path = this.path(id);

      try {

        this.context.save(module);

        module.isPending = true;
        const exportPromise =
            isBrowser ? this.loadInBrowser(path) : this.loadInNode(path);
        exportPromises.set(id, exportPromise);
        delete module.isPending;

        const exported = await exportPromise;
        if (!exported) {
          throw new Error(`No "module.exports" found in module with id: ${id}`);
        }

        module.exports = exported;

        if (typeof module.exports.init === 'function') {
          await module.exports.init();
        }

        this.context.restore(module);
        return exported;

      } catch (error) {
        this.report({
          id,
          error,
        });
      }
    }

    /*
     * Returns the resource path for the specified id.
     */
    path(id) {
      if (id.endsWith('/')) {
        return `${id}main.js`;
      }
      if (/^(.*)\.([a-z0-9]{1,4})$/.test(id)) {
        return id;
      }
      return `${id}.js`;
    }

    /*
     * Loads the script as a module in the browser environment.
     */
    async import(id) {
      const module = this.registry.get(id);
      if (module) {
        return module.exports;
      }
      const path = loader.path(id);
      const exported = await this.loadInBrowser(path, /*= isModule */ true);
      this.define(id, exported || null);
      return exported;
    }

    /*
     * Loads the script in the browser environment.
     */
    loadInBrowser(path, isModule = false) {
      return new Promise((resolve, reject) => {
        window.module = {
          exports: null,
        };
        const script = document.createElement('script');
        script.src = path;
        if (isModule) {
          script.type = 'module';
        }
        script.onload = () => {
          const exported = module.exports;
          delete window.module;
          resolve(exported);
        };
        script.onerror = error => {
          reject(error);
        };
        document.head.appendChild(script);
      });
    }

    /*
     * Loads the script in the node.js environment.
     */
    loadInNode(path) {
      const filePath = require('path').resolve(__dirname, path);
      if ($global.decache) {
        decache(filePath);
      }
      return require(filePath);
    }

    /*
     * Reports the error provided by the error message.
     */
    report(message) {
      console.error('Error loading module:', message.id);
      throw message.error;
    }

    /*
     * Creates an instance of a module with given id and registers it.
     */
    registerModule(id, isRequired = false) {
      const module = new Module(id, isRequired);
      this.registry.set(id, module);
      return module;
    }

    /*
     * Resets loader state.
     */
    reset() {
      this.ready = Promise.resolve(null);
      this.registry.clear();
      exportPromises.clear();
      loadPromises.clear();
    }
  }

  $global.loader = new Loader();
}

{
  const SUPPORTED_EVENTS = [
    // mouse events
    'onAuxClick',
    'onClick',
    'onContextMenu',
    'onDoubleClick',
    'onDrag',
    'onDragEnd',
    'onDragEnter',
    'onDragExit',
    'onDragLeave',
    'onDragOver',
    'onDragStart',
    'onDrop',
    'onMouseDown',
    'onMouseEnter',
    'onMouseLeave',
    'onMouseMove',
    'onMouseOut',
    'onMouseOver',
    'onMouseUp',
    // keyboard events
    'onKeyDown',
    'onKeyPress',
    'onKeyUp',
    // focus events
    'onFocus',
    'onBlur',
    // form events
    'onChange',
    'onInput',
    'onInvalid',
    'onSubmit',
    // clipboard events
    'onCopy',
    'onCut',
    'onPaste',
    // composition events
    'onCompositionEnd',
    'onCompositionStart',
    'onCompositionUpdate',
    // selection events
    'onSelect',
    // touch events
    'onTouchCancel',
    'onTouchEnd',
    'onTouchMove',
    'onTouchStart',
    // UI events
    'onScroll',
    // wheel events
    'onWheel',
    // media events
    'onAbort',
    'onCanPlay',
    'onCanPlayThrough',
    'onDurationChange',
    'onEmptied',
    'onEncrypted',
    'onEnded',
    'onError',
    'onLoadedData',
    'onLoadedMetadata',
    'onLoadStart',
    'onPause',
    'onPlay',
    'onPlaying',
    'onProgress',
    'onRateChange',
    'onSeeked',
    'onSeeking',
    'onStalled',
    'onSuspend',
    'onTimeUpdate',
    'onVolumeChange',
    'onWaiting',
    // image events
    'onLoad',
    'onError',
    // animation events
    'onAnimationStart',
    'onAnimationEnd',
    'onAnimationIteration',
    // transition events
    'onTransitionEnd',
    // search event
    'onSearch',
    // toogle event
    'onToggle',
  ];

  const SUPPORTED_ATTRIBUTES = [
    [
      'accept',
      [
        'form',
        'input',
      ],
    ],
    [
      'acceptCharset',
      [
        'form',
      ],
    ],
    [
      'accessKey',
    ],
    [
      'action',
      [
        'form',
      ],
    ],
    [
      'align',
      [
        'caption',
        'col',
        'colgroup',
        'hr',
        'iframe',
        'img',
        'table',
        'tbody',
        'td',
        'tfoot',
        'th',
        'thead',
        'tr',
      ],
    ],
    [
      'allow',
      [
        'iframe',
      ],
    ],
    [
      'allowFullScreen',
      [
        'iframe',
      ],
    ],
    [
      'alt',
      [
        'area',
        'img',
        'input',
      ],
    ],
    [
      'async',
      [
        'script',
      ],
    ],
    [
      'autoCapitalize',
    ],
    [
      'autoComplete',
      [
        'form',
        'input',
        'textarea',
      ],
    ],
    [
      'autoFocus',
      [
        'button',
        'input',
        'keygen',
        'select',
        'textarea',
      ],
    ],
    [
      'autoPlay',
      [
        'audio',
        'video',
      ],
    ],
    [
      'buffered',
      [
        'audio',
        'video',
      ],
    ],
    [
      'capture',
      [
        'input',
      ],
    ],
    [
      'challenge',
      [
        'keygen',
      ],
    ],
    [
      'charset',
      [
        'meta',
        'script',
      ],
    ],
    [
      'checked',
      [
        'command',
        'input',
      ],
    ],
    [
      'cite',
      [
        'blockquote',
        'del',
        'ins',
        'q',
      ],
    ],
    [
      'class',
    ],
    [
      'cols',
      [
        'textarea',
      ],
    ],
    [
      'colSpan',
      [
        'td',
        'th',
      ],
    ],
    [
      'content',
      [
        'meta',
      ],
    ],
    [
      'contentEditable',
    ],
    [
      'contextMenu',
    ],
    [
      'controls',
      [
        'audio',
        'video',
      ],
    ],
    [
      'coords',
      [
        'area',
      ],
    ],
    [
      'crossOrigin',
      [
        'audio',
        'img',
        'link',
        'script',
        'video',
      ],
    ],
    [
      'csp',
      [
        'iframe',
      ],
    ],
    [
      'data',
      [
        'object',
      ],
    ],
    [
      'dateTime',
      [
        'del',
        'ins',
        'time',
      ],
    ],
    [
      'decoding',
      [
        'img',
      ],
    ],
    [
      'default',
      [
        'track',
      ],
    ],
    [
      'defer',
      [
        'script',
      ],
    ],
    [
      'dir',
    ],
    [
      'disabled',
      [
        'button',
        'command',
        'fieldset',
        'input',
        'keygen',
        'optgroup',
        'option',
        'select',
        'textarea',
      ],
    ],
    [
      'download',
      [
        'a',
        'area',
      ],
    ],
    [
      'draggable',
    ],
    [
      'dropZone',
    ],
    [
      'encType',
      [
        'form',
      ],
    ],
    [
      'for',
      [
        'label',
        'output',
      ],
    ],
    [
      'form',
      [
        'button',
        'fieldset',
        'input',
        'keygen',
        'label',
        'meter',
        'object',
        'output',
        'progress',
        'select',
        'textarea',
      ],
    ],
    [
      'formAction',
      [
        'input',
        'button',
      ],
    ],
    [
      'headers',
      [
        'td',
        'th',
      ],
    ],
    [
      'height',
      [
        'canvas',
        'embed',
        'iframe',
        'img',
        'input',
        'object',
        'video',
      ],
    ],
    [
      'hidden',
    ],
    [
      'high',
      [
        'meter',
      ],
    ],
    [
      'href',
      [
        'a',
        'area',
        'base',
        'link',
      ],
    ],
    [
      'hrefLang',
      [
        'a',
        'area',
        'link',
      ],
    ],
    [
      'httpEquiv',
      [
        'meta',
      ],
    ],
    [
      'icon',
      [
        'command',
      ],
    ],
    [
      'id',
    ],
    [
      'incremental',
      [
        'input',
      ],
    ],
    [
      'inputMode',
      [
        'input',
      ],
    ],
    [
      'integrity',
      [
        'link',
        'script',
      ],
    ],
    [
      'is',
    ],
    [
      'isMap',
      [
        'img',
      ],
    ],
    [
      'itemProp',
    ],
    [
      'keyType',
      [
        'keygen',
      ],
    ],
    [
      'kind',
      [
        'track',
      ],
    ],
    [
      'label',
      [
        'track',
      ],
    ],
    [
      'lang',
    ],
    [
      'language',
      [
        'script',
      ],
    ],
    [
      'list',
      [
        'input',
      ],
    ],
    [
      'loop',
      [
        'audio',
        'bgsound',
        'marquee',
        'video',
      ],
    ],
    [
      'low',
      [
        'meter',
      ],
    ],
    [
      'manifest',
      [
        'html',
      ],
    ],
    [
      'max',
      [
        'input',
        'meter',
        'progress',
      ],
    ],
    [
      'maxLength',
      [
        'input',
        'textarea',
      ],
    ],
    [
      'media',
      [
        'a',
        'area',
        'link',
        'source',
        'style',
      ],
    ],
    [
      'method',
      [
        'form',
      ],
    ],
    [
      'min',
      [
        'input',
        'meter',
      ],
    ],
    [
      'minLength',
      [
        'input',
        'textarea',
      ],
    ],
    [
      'multiple',
      [
        'input',
        'select',
      ],
    ],
    [
      'muted',
      [
        'audio',
        'video',
      ],
    ],
    [
      'name',
      [
        'button',
        'form',
        'fieldset',
        'iframe',
        'input',
        'keygen',
        'object',
        'output',
        'select',
        'textarea',
        'map',
        'meta',
        'param',
        'slot',
      ],
    ],
    [
      'noValidate',
      [
        'form',
      ],
    ],
    [
      'open',
      [
        'details',
      ],
    ],
    [
      'optimum',
      [
        'meter',
      ],
    ],
    [
      'pattern',
      [
        'input',
      ],
    ],
    [
      'ping',
      [
        'a',
        'area',
      ],
    ],
    [
      'placeholder',
      [
        'input',
        'textarea',
      ],
    ],
    [
      'poster',
      [
        'video',
      ],
    ],
    [
      'preload',
      [
        'audio',
        'video',
      ],
    ],
    [
      'radioGroup',
      [
        'command',
      ],
    ],
    [
      'readOnly',
      [
        'input',
        'textarea',
      ],
    ],
    [
      'rel',
      [
        'a',
        'area',
        'link',
      ],
    ],
    [
      'required',
      [
        'input',
        'select',
        'textarea',
      ],
    ],
    [
      'reversed',
      [
        'ol',
      ],
    ],
    [
      'role',
    ],
    [
      'rows',
      [
        'textarea',
      ],
    ],
    [
      'rowSpan',
      [
        'td',
        'th',
      ],
    ],
    [
      'sandbox',
      [
        'iframe',
      ],
    ],
    [
      'scope',
      [
        'th',
      ],
    ],
    [
      'scoped',
      [
        'style',
      ],
    ],
    [
      'selected',
      [
        'option',
      ],
    ],
    [
      'shape',
      [
        'a',
        'area',
      ],
    ],
    [
      'size',
      [
        'input',
        'select',
      ],
    ],
    [
      'sizes',
      [
        'link',
        'img',
        'source',
      ],
    ],
    [
      'slot',
    ],
    [
      'span',
      [
        'col',
        'colgroup',
      ],
    ],
    [
      'spellCheck',
    ],
    [
      'src',
      [
        'audio',
        'embed',
        'iframe',
        'img',
        'input',
        'script',
        'source',
        'track',
        'video',
      ],
    ],
    [
      'srcDoc',
      [
        'iframe',
      ],
    ],
    [
      'srcLang',
      [
        'track',
      ],
    ],
    [
      'srcSet',
      [
        'img',
        'source',
      ],
    ],
    [
      'start',
      [
        'ol',
      ],
    ],
    [
      'step',
      [
        'input',
      ],
    ],
    [
      'summary',
      [
        'table',
      ],
    ],
    [
      'tabIndex',
    ],
    [
      'target',
      [
        'a',
        'area',
        'base',
        'form',
      ],
    ],
    [
      'title',
    ],
    [
      'translate',
    ],
    [
      'type',
      [
        'button',
        'input',
        'command',
        'embed',
        'object',
        'script',
        'source',
        'style',
        'menu',
      ],
    ],
    [
      'useMap',
      [
        'img',
        'input',
        'object',
      ],
    ],
    [
      'value',
      [
        'button',
        'option',
        'input',
        'li',
        'meter',
        'progress',
        'param',
      ],
    ],
    [
      'width',
      [
        'canvas',
        'embed',
        'iframe',
        'img',
        'input',
        'object',
        'video',
      ],
    ],
    [
      'wrap',
      [
        'textarea',
      ],
    ],
    [
      'ariaActiveDescendant',
    ],
    [
      'ariaAtomic',
    ],
    [
      'ariaAutoComplete',
    ],
    [
      'ariaBusy',
    ],
    [
      'ariaChecked',
    ],
    [
      'ariaControls',
    ],
    [
      'ariaDescribedBy',
    ],
    [
      'ariaDisabled',
    ],
    [
      'ariaDropEffect',
    ],
    [
      'ariaExpanded',
    ],
    [
      'ariaFlowTo',
    ],
    [
      'ariaGrabbed',
    ],
    [
      'ariaHasPopup',
    ],
    [
      'ariaHidden',
    ],
    [
      'ariaInvalid',
    ],
    [
      'ariaLabel',
    ],
    [
      'ariaLabelLedBy',
    ],
    [
      'ariaLevel',
    ],
    [
      'ariaLive',
    ],
    [
      'ariaMultiLine',
    ],
    [
      'ariaMultiSelectable',
    ],
    [
      'ariaOrientation',
    ],
    [
      'ariaOwns',
    ],
    [
      'ariaPosInSet',
    ],
    [
      'ariaPressed',
    ],
    [
      'ariaReadOnly',
    ],
    [
      'ariaRelevant',
    ],
    [
      'ariaRequired',
    ],
    [
      'ariaSelected',
    ],
    [
      'ariaSetSize',
    ],
    [
      'ariaSort',
    ],
    [
      'ariaValueMax',
    ],
    [
      'ariaValueMin',
    ],
    [
      'ariaValueNow',
    ],
    [
      'ariaValueText',
    ],
  ];

  const SUPPORTED_STYLES = Object.keys(document.documentElement.style);

  const SUPPORTED_FILTERS = [
    'blur',
    'brightness',
    'contrast',
    'dropShadow',
    'grayscale',
    'hueRotate',
    'invert',
    'opacity',
    'sepia',
    'saturate',
  ];

  const SUPPORTED_TRANSFORMS = [
    'matrix',
    'matrix3d',
    'translate',
    'translate3d',
    'translateX',
    'translateY',
    'translateZ',
    'scale',
    'scale3d',
    'scaleX',
    'scaleY',
    'scaleZ',
    'rotate',
    'rotate3d',
    'rotateX',
    'rotateY',
    'rotateZ',
    'skew',
    'skewX',
    'skewY',
    'perspective',
  ];

  const supportedAttributes = new Map();
  for (const [key, whitelist] of SUPPORTED_ATTRIBUTES) {
    supportedAttributes.set(key, whitelist || '*');
  }

  const Browser = {

    isAttributeSupported(key) {
      return supportedAttributes.has(key);
    },

    isAttributeValid(key, element) {
      const whitelist = supportedAttributes.get(key);
      if (whitelist) {
        return whitelist === '*' || whitelist.includes(element);
      }
      return false;
    },

    getValidElementNamesFor(key) {
      return supportedAttributes.get(key);
    },

    isEventSupported(key) {
      return SUPPORTED_EVENTS.includes(key);
    },

    isStyleSupported(key) {
      return key.startsWith('--') || SUPPORTED_STYLES.includes(key);
    },

    isFilterSupported(key) {
      return SUPPORTED_FILTERS.includes(key);
    },

    isTransformSupported(key) {
      return SUPPORTED_TRANSFORMS.includes(key);
    },

    SUPPORTED_FILTERS,
    SUPPORTED_TRANSFORMS,
  };

  loader.define('core/browser', Browser);
}

{
  const Mode = {
    QUEUE: Symbol('queue-commands'),
    EXECUTE: Symbol('execute-commands'),
    IGNORE: Symbol('ignore-commands'),
  };

  const coreAPI = {
    setState(state) {
      return () => state;
    },
    update(overrides) {
      return state => ({
        ...state,
        ...overrides,
      });
    },
  };

  class Command {

    constructor(name, args, method) {
      this.name = name;
      this.args = args;
      this.method = method;
    }

    invoke(state) {
      return this.method(...this.args)(state);
    }
  }

  const createCommandsAPI = (...apis) => {
    let commandsAPI = {};
    for (const api of [coreAPI, ...apis]) {
      const defined = Object.keys(commandsAPI);
      const incoming = Object.keys(api);
      const overriden = incoming.find(key => defined.includes(key));
      if (overriden) {
        throw new Error(`The "${overriden}" command is already defined!`);
      }
      Object.assign(commandsAPI, api);
    }
    return commandsAPI;
  };

  class Dispatcher {

    queueIncoming() {
      this.mode = Mode.QUEUE;
    }

    executeIncoming() {
      this.mode = Mode.EXECUTE;
    }

    ignoreIncoming() {
      this.mode = Mode.IGNORE;
    }

    execute(command, root) {
      const prevState = root.state;
      const nextState = command.invoke(prevState);
      root.state = nextState;
      opr.Toolkit.Renderer.update(root, prevState, nextState, command);
    }

    constructor(root) {

      this.mode = Mode.EXECUTE;
      this.queue = [];
      this.commands = {};

      let createCommand;

      const ComponentClass = root.constructor;
      if (typeof ComponentClass.getCommands === 'function') {

        const customAPI = ComponentClass.getCommands();
        if (!customAPI) {
          throw new Error('No API returned in getCommands() method');
        }
        const customAPIs = Array.isArray(customAPI) ? customAPI : [customAPI];
        const api = createCommandsAPI(...customAPIs);

        this.names = Object.keys(api);
        createCommand = (name, args) => new Command(name, args, api[name]);

      } else {

        const reducers = root.getReducers ? root.getReducers() : [];
        const combinedReducer = opr.Toolkit.Reducers.combine(...reducers);
        const api = combinedReducer.commands;

        this.names = Object.keys(api);
        createCommand = (name, args) => new Command(
            name, args,
            () => state => combinedReducer(state, api[name](...args)));
      }

      this.mode = Mode.EXECUTE;
      let level = 0;

      for (const name of this.names) {
        this.commands[name] = (...args) => {

          const command = createCommand(name, args);

          if (this.mode === Mode.QUEUE) {
            const donePromise = new Promise(resolve => {
              command.done = resolve;
            });
            this.queue.push(command);
            return donePromise;
          }

          if (this.mode === Mode.IGNORE) {
            level = 0;
            return false;
          }

          this.execute(command, root);

          if (this.queue.length) {
            level = level + 1;
            if (level > 3) {
              try {
                throw new Error(
                    'Too many cycles updating state in lifecycle methods!');
              } finally {
                level = 0;
              }
            }
            const tasks = [...this.queue];
            setTimeout(() => {
              for (const command of tasks) {
                this.execute(command, root);
                command.done();
              }
            });
            this.queue.length = 0;
          } else {
            level = 0;
            return true;
          }
        };
      }
    }
  }

  loader.define('core/dispatcher', Dispatcher);
}


{
  /*
   * An abstract parent node.
   */
  class VirtualNode {

    constructor(description, parentNode = null, context = null) {
      this.description = description;
      this.key = description.key;
      this.parentNode = parentNode;
      this.context = context;
    }

    createChildren() {
      this.children = this.description.children.map(
          childDescription => this.createChild(childDescription));
    }

    createChild(description) {
      return opr.Toolkit.VirtualDOM.createFromDescription(
          description, this, this.context);
    }

    get parentElement() {
      if (this.parentNode) {
        return this.parentNode.isElement() ? this.parentNode :
                                             this.parentNode.parentElement;
      }
      return null;
    }

    get container() {
      if (this.parentNode) {
        return this.parentNode.container;
      }
      return this;
    }

    get rootNode() {
      if (this.isRoot()) {
        return this;
      }
      if (this.parentNode) {
        return this.parentNode.rootNode;
      }
      throw new Error('Inconsistent virtual DOM tree detected!');
    }

    attachChildren() {
      if (this.children) {
        for (const child of this.children) {
          this.ref.appendChild(child.ref);
        }
      }
    }

    insertChild(child, index) {
      if (!this.children) {
        this.children = [];
      }
      if (index === undefined) {
        index = this.children.length;
      }
      const nextChild = this.children[index];
      this.children.splice(index, 0, child);
      this.ref.insertBefore(child.ref, nextChild && nextChild.ref || null);
      child.parentNode = this;
    }

    replaceChild(child, node) {
      const index = this.children.indexOf(child);
      opr.Toolkit.assert(
          index >= 0, 'Specified node is not a child of this element!');
      this.children.splice(index, 1, node);
      child.parentNode = null;
      node.parentNode = this;
      child.ref.replaceWith(node.ref);
    }

    moveChild(child, from, to) {
      opr.Toolkit.assert(
          this.children[from] === child,
          'Specified node is not a child of this element!');
      this.children.splice(from, 1);
      this.children.splice(to, 0, child);
      this.ref.removeChild(child.ref);
      this.ref.insertBefore(child.ref, this.ref.children[to]);
    }

    removeChild(child) {
      const index = this.children.indexOf(child);
      opr.Toolkit.assert(
          index >= 0, 'Specified node is not a child of this element!');
      this.children.splice(index, 1);
      if (!this.children.length) {
        delete this.children;
      }
      this.ref.removeChild(child.ref);
    }

    isRoot() {
      return this instanceof WebComponent;
    }

    isComponent() {
      return this instanceof Component;
    }

    isElement() {
      return this instanceof VirtualElement;
    }

    isComment() {
      return this instanceof Comment;
    }

    isText() {
      return this instanceof Text;
    }

    isCompatible(node) {
      return node && this.nodeType === node.nodeType && this.key === node.key;
    }
  }

  /*
   * Node representing Component in the virtual DOM tree.
   * Components
   */
  class Component extends VirtualNode {

    static get NodeType() {
      return 'component';
    }

    static get displayName() {
      return this.name;
    }

    constructor(description, parent, context, attachDOM = true) {
      super(description, parent, context);
      this.sandbox = opr.Toolkit.Sandbox.create(this);
      this.cleanUpTasks = [];
      this.isInitialized = attachDOM;
      if (attachDOM) {
        this.attachDOM();
      }
      // the rendered content is inserted right after instantiation
      this.content = null;
    }

    /*
     * Sets the component content.
     */
    setContent(node) {
      opr.Toolkit.assert(
          node.parentNode === this,
          'Specified node does not have a valid parent!');
      this.content.parentNode = null;
      node.parentNode = this;
      this.content.ref.replaceWith(node.ref);
      this.content = node;
    }

    hasOwnMethod(method) {
      // eslint-disable-next-line no-prototype-builtins
      return this.constructor.prototype.hasOwnProperty(method);
    }

    connectTo(service, listeners) {
      opr.Toolkit.assert(
          typeof service.connect === 'function',
          'Services have to define the connect() method');
      const disconnect = service.connect(listeners);
      opr.Toolkit.assert(
          typeof disconnect === 'function',
          'The result of the connect() method has to be a disconnect() method');
      disconnect.service = service;
      this.cleanUpTasks.push(disconnect);
    }

    get childElement() {
      if (this.content) {
        if (this.content.isElement() || this.content.isRoot()) {
          return this.content;
        }
        if (this.content.isComponent()) {
          return this.content.childElement;
        }
      }
      return null;
    }

    get placeholder() {
      if (this.content.isComment()) {
        return this.content;
      }
      return this.content.placeholder || null;
    }

    render() {
      return undefined;
    }

    get commands() {
      return this.context ? this.context.commands : this.rootNode.commands;
    }

    get dispatcher() {
      return this.context ? this.context.dispatcher : this.rootNode.dispatcher;
    }

    destroy() {
      for (const cleanUpTask of this.cleanUpTasks) {
        cleanUpTask();
      }
    }

    get nodeType() {
      return Component.NodeType;
    }

    get ref() {
      return this.content.ref;
    }

    isCompatible(node) {
      return super.isCompatible(node) && this.constructor === node.constructor;
    }

    attachDOM() {
      if (this.content) {
        this.content.attachDOM();
      }
    }

    detachDOM() {
      if (this.content) {
        this.content.detachDOM();
      }
    }
  }

  const CONTAINER = Symbol('container');
  const CUSTOM_ELEMENT = Symbol('custom-element');
  const DISPATCHER = Symbol('dispatcher');

  class WebComponent extends Component {

    static get NodeType() {
      return 'root';
    }

    static get styles() {
      return [];
    }

    constructor(description, parent = null, context = null) {
      super(description, parent, context, /*= attachDOM */ false);
      this.subroots = new Set();
      this.dispatcher = new opr.Toolkit.Dispatcher(this);
      this.ready = new Promise(resolve => {
        this.markAsReady = resolve;
      });
      this.plugins = this.createPlugins();
      this.content = this.createPlaceholder();
      this.shadow = null;
      this.attachDOM();
    }

    attachDOM() {
      if (this.constructor.elementName) {
        this.ref = opr.Toolkit.Renderer.createCustomElement(this);
        this.plugins.installAll();
        if (this.description.children) {
          this.createChildren();
          this.attachChildren();
        }
      } else {
        this.plugins.installAll();
        super.attachDOM();
      }
    }

    createPlaceholder() {
      return opr.Toolkit.VirtualDOM.createFromDescription(
          new opr.Toolkit.Description.CommentDescription(
              this.constructor.displayName));
    }

    /*
     * Triggers the initial rendering of the component in given container.
     */
    async init() {
      opr.Toolkit.track(this);

      const state = await this.getInitialState.call(
          this.sandbox, this.description.props || {});
      this.setState(state);

      if (this.pendingDescription) {
        const description = this.pendingDescription;
        delete this.pendingDescription;
        setTimeout(() => this.update(description));
      }
      this.isInitialized = true;
      this.markAsReady();
    }

    setState(state) {
      if (state.constructor !== Object) {
        throw new Error('Web Component state must be a plain object!');
      }
      this.commands.setState(opr.Toolkit.Template.normalizeComponentProps(
          state, this.constructor));
    }

    /*
     * Triggers the component update.
     */
    update(description) {
      if (!this.isInitialized) {
        this.pendingDescription = description;
        return;
      }
      const state = this.getUpdatedState(
          description.props || {}, this.state || {});
      this.setState(state);
    }

    /*
     * The default implementation delegating the calculation of initial state
     * to the state manager.
     */
    async getInitialState(props) {
      return {
        ...props,
      };
    }

    /*
     * The default implementation delegating the calculation of updated state
     * to the state manager.
     */
    getUpdatedState(props, state) {
      return {
        ...state,
        ...props,
      };
    }

    get dispatcher() {
      return this[DISPATCHER];
    }

    set dispatcher(dispatcher) {
      this[DISPATCHER] = dispatcher;
    }

    get commands() {
      return this.dispatcher.commands;
    }

    createPlugins() {
      const plugins = new opr.Toolkit.Plugins(this);
      const inherited =
          this.parentNode ? this.parentNode.plugins : opr.Toolkit.plugins;
      for (const plugin of inherited) {
        plugins.register(plugin);
      }
      return plugins;
    }

    async mount(container) {
      if (this.constructor.elementName) {
        // triggers this.init() from element's connected callback
        container.appendChild(this.ref);
        await this.ready;
      } else {
        this.container = container;
        await this.init();
      }
      return this;
    }

    getStylesheets() {
      const stylesheets = [];
      const stylesheetProviders =
          [...this.plugins].filter(plugin => plugin.isStylesheetProvider());
      for (const plugin of stylesheetProviders) {
        if (typeof plugin.getStylesheets !== 'function') {
          throw new Error(
              `Plugin '${
                         plugin.name
                       }' must provide the getStylesheets() method!`);
        }
        stylesheets.push(...plugin.getStylesheets());
      }
      if (Array.isArray(this.constructor.styles)) {
        stylesheets.push(...this.constructor.styles);
      }
      return stylesheets;
    }

    get ref() {
      return this[CUSTOM_ELEMENT] || super.ref;
    }

    set ref(ref) {
      this[CUSTOM_ELEMENT] = ref;
    }

    set container(container) {
      this[CONTAINER] = container;
    }

    get container() {
      return this[CONTAINER];
    }

    get tracked() {
      const tracked = [];
      for (const root of this.subroots) {
        tracked.push(root, ...root.tracked);
      }
      return tracked;
    }

    destroy() {
      super.destroy();
      try {
        this.stopTracking();
      } catch (e) {
        return;
      }
      this.dispatcher.ignoreIncoming();
      this.plugins.destroy();
      this.plugins = null;
      this.parentNode = null;
    }

    get nodeType() {
      return WebComponent.NodeType;
    }
  }

  class VirtualElement extends VirtualNode {

    static get NodeType() {
      return 'element';
    }

    constructor(description, parent, context) {
      super(description, parent, context);
      if (description.children) {
        this.createChildren();
      }
      this.attachDOM();
    }

    get nodeType() {
      return VirtualElement.NodeType;
    }

    isCompatible(node) {
      return super.isCompatible(node) && this.name === node.name;
    }

    attachDOM() {
      this.ref = opr.Toolkit.Renderer.createElement(this.description);
      this.attachChildren();
    }

    detachDOM() {
      for (const child of this.children) {
        child.detachDOM();
      }
      this.ref = null;
    }
  }

  class Comment extends VirtualNode {

    static get NodeType() {
      return 'comment';
    }

    constructor(description, parentNode) {
      super(description, parentNode);
      this.attachDOM();
    }

    get nodeType() {
      return Comment.NodeType;
    }

    attachDOM() {
      this.ref = document.createComment(` ${this.description.text} `);
    }

    detachDOM() {
      this.ref = null;
    }
  }

  class Text extends VirtualNode {

    static get NodeType() {
      return 'text';
    }

    constructor(description, parentNode) {
      super(description, parentNode);
      this.attachDOM();
    }

    get nodeType() {
      return Text.NodeType;
    }

    attachDOM() {
      this.ref = document.createTextNode(this.description.text);
    }

    detachDOM() {
      this.ref = null;
    }
  }

  const CoreTypes = {
    VirtualNode,
    Component,
    WebComponent,
    Root: WebComponent,
    VirtualElement,
    Comment,
    Text,
  };

  loader.define('core/nodes', CoreTypes);
}

{
  class Diff {

    /*
     * Creates a new instance bound to a root component
     * with an empty list of patches.
     */
    constructor(root, currentState, nextState) {
      this.root = root;
      this.patches = [];
      this.calculate(currentState, nextState);
    }

    /*
     * Adds the patch to the underlying list.
     */
    addPatch(patch) {
      return this.patches.push(patch);
    }

    /*
     * Applies all the patches onto the bound root node.
     */
    apply() {
      if (this.patches.length) {
        opr.Toolkit.Lifecycle.beforeUpdate(this.patches);
        for (const patch of this.patches) {
          patch.apply();
        }
        opr.Toolkit.Lifecycle.afterUpdate(this.patches);
      }
      return this.patches;
    }

    /*
     * Calculates and returns all patches needed for transformation
     * of the rendered DOM fragment from one state to another.
     */
    calculate(currentState, nextState) {

      if (!currentState) {
        this.addPatch(opr.Toolkit.Patch.initRootComponent(this.root));
      }

      if (Diff.deepEqual(currentState, nextState)) {
        return [];
      }

      const template = [
        this.root.constructor,
        nextState,
      ];
      if (this.root.description.children) {
        template.push(
            ...this.root.description.children.map(child => child.asTemplate));
      }

      const description = opr.Toolkit.Template.describe(template);

      this.componentPatches(this.root, description);
      if (this.root.description.attrs || description.attrs) {
        this.attributePatches(
            this.root.description.attrs, description.attrs, this.root, true);
      }
    }

    /**
     * Renders the descendants with normalized props and children passed
     * from the parent component.
     *
     * Calculates the patches needed for transformation of a component
     * to match the given description.
     */
    componentPatches(component, description) {

      if (component.isInitialized &&
          Diff.deepEqual(component.description, description)) {
        return;
      }

      const nodeDescription = opr.Toolkit.Renderer.render(
          component, description.props, description.childrenAsTemplates, true);
      this.componentContentPatches(nodeDescription, component);

      this.addPatch(opr.Toolkit.Patch.updateNode(component, description));
    }

    componentContentPatches(description, parent) {

      const content = parent.content;

      const {
        Diff,
        Patch,
        VirtualDOM,
      } = opr.Toolkit;

      if (!content && !description) {
        return;
      }

      // insert
      if (!content && description) {
        throw new Error('Invalid component state!');
      }

      // remove
      if (content && !description) {
        throw new Error('Invalid component state!');
      }

      // update
      if (content.description.isCompatible(description)) {
        if (Diff.deepEqual(content.description, description)) {
          return;
        }
        this.childPatches(content, description);
        return;
      }

      // replace
      const node =
          VirtualDOM.createFromDescription(description, parent, this.root);
      this.addPatch(Patch.setContent(node, parent));
    }

    /*
     * Calculates patches for transformation of specified child node
     * to match given description.
     */
    childPatches(child, description) {
      if (child.isComponent()) {
        if (child.isRoot()) {
          this.childrenPatches(child.children, description.children, child);
          this.addPatch(opr.Toolkit.Patch.updateNode(child, description));
          return child.update(description);
        }
        return this.componentPatches(child, description);
      }
      if (child.isElement()) {
        return this.elementPatches(child, description);
      }
      throw new Error('Unsupported node type:', child.nodeType);
    }

    /*
     * Calculates patches for transformation of an element to match given
     * description.
     */
    elementPatches(element, description) {

      if (Diff.deepEqual(element.description, description)) {
        return;
      }

      this.classNamePatches(
          element.description.class, description.class, element);
      this.stylePatches(element.description.style, description.style, element);
      this.attributePatches(
          element.description.attrs, description.attrs, element);
      this.listenerPatches(
          element.description.listeners, description.listeners, element);
      this.datasetPatches(
          element.description.dataset, description.dataset, element);
      this.propertiesPatches(
          element.description.properties, description.properties, element);

      if (element.description.custom || description.custom) {
        this.attributePatches(
            element.description.custom && element.description.custom.attrs,
            description.custom && description.custom.attrs, element, true);
        this.listenerPatches(
            element.description.custom && element.description.custom.listeners,
            description.custom && description.custom.listeners, element, true);
      }

      if (element.children || description.children) {
        this.childrenPatches(
            element.children, description.children, element);
      }
      this.addPatch(opr.Toolkit.Patch.updateNode(element, description));
    }

    classNamePatches(current = '', next = '', target) {
      if (current !== next) {
        this.addPatch(opr.Toolkit.Patch.setClassName(next, target));
      }
    }

    stylePatches(current = {}, next = {}, target) {
      const Patch = opr.Toolkit.Patch;

      const props = Object.keys(current);
      const nextProps = Object.keys(next);

      const added = nextProps.filter(prop => !props.includes(prop));
      const removed = props.filter(prop => !nextProps.includes(prop));
      const changed = props.filter(
          prop => nextProps.includes(prop) && current[prop] !== next[prop]);

      for (let prop of added) {
        this.addPatch(Patch.setStyleProperty(prop, next[prop], target));
      }
      for (let prop of removed) {
        this.addPatch(Patch.removeStyleProperty(prop, target));
      }
      for (let prop of changed) {
        this.addPatch(Patch.setStyleProperty(prop, next[prop], target));
      }
    }

    attributePatches(current = {}, next = {}, target = null, isCustom = false) {

      const Patch = opr.Toolkit.Patch;

      const attrs = Object.keys(current);
      const nextAttrs = Object.keys(next);

      const added = nextAttrs.filter(attr => !attrs.includes(attr));
      const removed = attrs.filter(attr => !nextAttrs.includes(attr));
      const changed = attrs.filter(
          attr => nextAttrs.includes(attr) && current[attr] !== next[attr]);

      for (let attr of added) {
        this.addPatch(Patch.setAttribute(attr, next[attr], target, isCustom));
      }
      for (let attr of removed) {
        this.addPatch(Patch.removeAttribute(attr, target, isCustom));
      }
      for (let attr of changed) {
        this.addPatch(Patch.setAttribute(attr, next[attr], target, isCustom));
      }
    }

    listenerPatches(current = {}, next = {}, target = null, isCustom = false) {
      const Patch = opr.Toolkit.Patch;

      const listeners = Object.keys(current);
      const nextListeners = Object.keys(next);

      const added = nextListeners.filter(event => !listeners.includes(event));
      const removed = listeners.filter(event => !nextListeners.includes(event));
      const changed = listeners.filter(
          event => nextListeners.includes(event) &&
              current[event] !== next[event] &&
              (current[event].source === undefined &&
                   next[event].source === undefined ||
               current[event].source !== next[event].source));

      for (let event of added) {
        this.addPatch(Patch.addListener(event, next[event], target, isCustom));
      }
      for (let event of removed) {
        this.addPatch(
            Patch.removeListener(event, current[event], target, isCustom));
      }
      for (let event of changed) {
        this.addPatch(Patch.replaceListener(
            event, current[event], next[event], target, isCustom));
      }
    }

    datasetPatches(current = {}, next = {}, target) {
      const Patch = opr.Toolkit.Patch;

      const attrs = Object.keys(current);
      const nextAttrs = Object.keys(next);

      const added = nextAttrs.filter(attr => !attrs.includes(attr));
      const removed = attrs.filter(attr => !nextAttrs.includes(attr));
      const changed = attrs.filter(
          attr => nextAttrs.includes(attr) && current[attr] !== next[attr]);

      for (let attr of added) {
        this.addPatch(Patch.setDataAttribute(attr, next[attr], target));
      }
      for (let attr of removed) {
        this.addPatch(Patch.removeDataAttribute(attr, target));
      }
      for (let attr of changed) {
        this.addPatch(Patch.setDataAttribute(attr, next[attr], target));
      }
    }

    propertiesPatches(current = {}, next = {}, target = null) {
      const Patch = opr.Toolkit.Patch;

      const keys = Object.keys(current);
      const nextKeys = Object.keys(next);

      const added = nextKeys.filter(key => !keys.includes(key));
      const removed = keys.filter(key => !nextKeys.includes(key));
      const changed = keys.filter(
          key => nextKeys.includes(key) &&
              !Diff.deepEqual(current[key], next[key]));

      for (let key of added) {
        this.addPatch(Patch.setProperty(key, next[key], target));
      }
      for (let key of removed) {
        this.addPatch(Patch.deleteProperty(key, target));
      }
      for (let key of changed) {
        this.addPatch(Patch.setProperty(key, next[key], target));
      }
    }

    childrenPatches(sourceNodes = [], targetDescriptions = [], parent) {

      const {
        Patch,
        Reconciler,
        VirtualDOM,
      } = opr.Toolkit;
      const Move = Reconciler.Move;

      const created = [];
      const createdNodesMap = new Map();

      const createNode = (description, key) => {
        const node =
            VirtualDOM.createFromDescription(description, parent, this.root);
        created.push(node);
        createdNodesMap.set(key, node);
        return node;
      };

      const from =
          sourceNodes.map((node, index) => node.key || Diff.createKey(index));
      const to = targetDescriptions.map(
          (description, index) => description.key || Diff.createKey(index));

      const getNode = (key, isMove) => {
        if (from.includes(key)) {
          return sourceNodes[from.indexOf(key)];
        }
        if (isMove) {
          return createdNodesMap.get(key);
        }
        const index = to.indexOf(key);
        return createNode(targetDescriptions[index], key);
      };

      if (opr.Toolkit.isDebug()) {
        const assertUniqueKeys = keys => {
          if (keys.length) {
            const uniqueKeys = [...new Set(keys)];
            if (uniqueKeys.length !== keys.length) {
              throw new Error('Non-unique keys detected in:', keys);
            }
          }
        };
        assertUniqueKeys(from);
        assertUniqueKeys(to);
      }

      const nodeFavoredToMove = sourceNodes.find(
          node =>
              node.description.props && node.description.props.beingDragged);

      const moves = Reconciler.calculateMoves(
          from, to, nodeFavoredToMove && nodeFavoredToMove.key);

      const children = [...sourceNodes];
      for (const move of moves) {
        const node = getNode(move.item, move.name === Move.Name.MOVE);
        switch (move.name) {
          case Move.Name.REMOVE:
            this.addPatch(Patch.removeChild(node, move.at, parent));
            Move.remove(node, move.at).make(children);
            continue;
          case Move.Name.INSERT:
            this.addPatch(Patch.insertChild(node, move.at, parent));
            Move.insert(node, move.at).make(children);
            continue;
          case Move.Name.MOVE:
            this.addPatch(Patch.moveChild(node, move.from, move.to, parent));
            Move.move(node, move.from, move.to).make(children);
            continue;
        }
      }
      for (let i = 0; i < children.length; i++) {
        const child = children[i];
        if (!created.includes(child)) {
          const targetDescription = targetDescriptions[i];
          this.elementChildPatches(child, targetDescription, parent);
        }
      }
    }

    elementChildPatches(child, description, parent) {
      if (child.description.isCompatible(description)) {
        if (opr.Toolkit.Diff.deepEqual(child.description, description)) {
          return;
        }
        this.childPatches(child, description);
      } else {
        const node = opr.Toolkit.VirtualDOM.createFromDescription(
            description, parent, this.root);
        this.addPatch(opr.Toolkit.Patch.replaceChild(child, node, parent));
      }
    }

    /*
     * Returns a normalized type of given item.
     */
    static getType(item) {
      const type = typeof item;
      if (type !== 'object') {
        return type;
      }
      if (item === null) {
        return 'null';
      }
      if (Array.isArray(item)) {
        return 'array';
      }
      return 'object';
    }

    static createKey(index) {
      return String(index).padStart(8, '0');
    }

    static deepEqual(current, next) {
      if (Object.is(current, next)) {
        return true;
      }
      const type = this.getType(current);
      const nextType = this.getType(next);
      if (type !== nextType) {
        return false;
      }
      if (type === 'array') {
        if (current.length !== next.length) {
          return false;
        }
        for (let i = 0; i < current.length; i++) {
          const equal = this.deepEqual(current[i], next[i]);
          if (!equal) {
            return false;
          }
        }
        return true;
      } else if (type === 'object') {
        if (current.constructor !== next.constructor) {
          return false;
        }
        const keys = Object.keys(current);
        const nextKeys = Object.keys(next);
        if (keys.length !== nextKeys.length) {
          return false;
        }
        keys.sort();
        nextKeys.sort();
        for (let i = 0; i < keys.length; i++) {
          const key = keys[i];
          if (key !== nextKeys[i]) {
            return false;
          }
          const equal = this.deepEqual(current[key], next[key]);
          if (!equal) {
            return false;
          }
        }
        return true;
      }
      return false;
    }
  }

  loader.define('core/diff', Diff);
}

{
  const Lifecycle = {

    onComponentCreated(component) {
      if (component.hasOwnMethod('onCreated')) {
        component.dispatcher.queueIncoming();
        component.onCreated.call(component.sandbox);
        component.dispatcher.executeIncoming();
      }
      if (component.content) {
        this.onNodeCreated(component.content);
      }
    },

    onElementCreated(element) {
      if (element.children) {
        for (const child of element.children) {
          this.onNodeCreated(child);
        }
      }
    },

    onNodeCreated(node) {
      if (node.isElement()) {
        return this.onElementCreated(node);
      } else if (node.isComponent() && !node.isRoot()) {
        return this.onComponentCreated(node);
      }
    },

    onRootCreated(root) {
      if (root.hasOwnMethod('onCreated')) {
        root.dispatcher.queueIncoming();
        root.onCreated.call(root.sandbox);
        root.dispatcher.executeIncoming();
      }
      if (root.children) {
        for (const child of root.children) {
          this.onNodeCreated(child);
        }
      }
    },

    onComponentAttached(component) {
      if (component.content) {
        this.onNodeAttached(component.content);
      }
      if (component.hasOwnMethod('onAttached')) {
        component.dispatcher.queueIncoming();
        component.onAttached.call(component.sandbox);
        component.dispatcher.executeIncoming();
      }
    },

    onElementAttached(element) {
      if (element.children) {
        for (const child of element.children) {
          this.onNodeAttached(child);
        }
      }
    },

    onNodeAttached(node) {
      if (node.isElement()) {
        return this.onElementAttached(node);
      } else if (node.isComponent() && !node.isRoot()) {
        return this.onComponentAttached(node);
      }
    },

    onNodeReceivedDescription(node, description) {
      if (node.isComponent()) {
        this.onComponentReceivedProps(node, description.props);
      }
    },

    onNodeUpdated(node, prevDescription) {
      if (node.isComponent()) {
        this.onComponentUpdated(node, prevDescription.props);
      }
    },

    onRootAttached(root) {
      if (root.children) {
        for (const child of root.children) {
          this.onNodeAttached(child);
        }
      }
      if (root.hasOwnMethod('onAttached')) {
        root.onAttached.call(root.sandbox);
      }
    },

    onComponentReceivedProps(component, nextProps = {}) {
      if (component.hasOwnMethod('onPropsReceived')) {
        component.dispatcher.queueIncoming();
        component.onPropsReceived.call(component.sandbox, nextProps);
        component.dispatcher.executeIncoming();
      }
    },

    onComponentUpdated(component, prevProps = {}) {
      if (component.hasOwnMethod('onUpdated')) {
        component.dispatcher.queueIncoming();
        component.onUpdated.call(component.sandbox, prevProps);
        component.dispatcher.executeIncoming();
      }
    },

    onComponentDestroyed(component) {
      component.destroy();
      if (component.hasOwnMethod('onDestroyed')) {
        component.dispatcher.ignoreIncoming();
        component.onDestroyed.call(component.sandbox);
      }
      if (component.content) {
        this.onNodeDestroyed(component.content);
      }
      if (component.isRoot()) {
        this.onElementDestroyed(component);
      }
    },

    onElementDestroyed(element) {
      if (element.children) {
        for (const child of element.children) {
          this.onNodeDestroyed(child);
        }
      }
    },

    onNodeDestroyed(node) {
      if (node.isElement()) {
        return this.onElementDestroyed(node);
      } else if (node.isComponent() && !node.isRoot()) {
        return this.onComponentDestroyed(node);
      }
    },

    onComponentDetached(component) {
      if (component.isRoot()) {
        this.onElementDetached(component);
      }
      if (component.content) {
        this.onNodeDetached(component.content);
      }
      if (component.hasOwnMethod('onDetached')) {
        component.dispatcher.ignoreIncoming();
        component.onDetached.call(component.sandbox);
      }
    },

    onElementDetached(element) {
      if (element.children) {
        for (const child of element.children) {
          this.onNodeDetached(child);
        }
      }
    },

    onNodeDetached(node) {
      if (node.isElement()) {
        this.onElementDetached(node);
        node.parentNode = null;
      } else if (node.isComponent() && !node.isRoot()) {
        this.onComponentDetached(node);
        node.parentNode = null;
      }
    },

    beforeUpdate(patches) {
      for (const patch of patches) {
        this.beforePatchApplied(patch);
      }
    },

    beforePatchApplied(patch) {
      const Type = opr.Toolkit.Patch.Type;
      switch (patch.type) {
        case Type.INIT_ROOT_COMPONENT:
          this.onRootCreated(patch.root);
          return;
        case Type.INSERT_CHILD:
          this.onNodeCreated(patch.node);
          return;
        case Type.REPLACE_CHILD:
        case Type.SET_CONTENT:
          this.onNodeDestroyed(patch.child);
          this.onNodeCreated(patch.node);
          return;
        case Type.REMOVE_CHILD:
          this.onNodeDestroyed(patch.child);
          return;
        case Type.UPDATE_NODE:
          this.onNodeReceivedDescription(patch.node, patch.description);
          return;
      }
    },

    afterUpdate(patches) {
      patches = [...patches].reverse();
      for (const patch of patches) {
        this.afterPatchApplied(patch);
      }
    },

    afterPatchApplied(patch) {
      const Type = opr.Toolkit.Patch.Type;
      switch (patch.type) {
        case Type.INIT_ROOT_COMPONENT:
          this.onRootAttached(patch.root);
          return;
        case Type.INSERT_CHILD:
          this.onNodeAttached(patch.node);
          return;
        case Type.REPLACE_CHILD:
        case Type.SET_CONTENT:
          this.onNodeDetached(patch.child);
          this.onNodeAttached(patch.node);
          return;
        case Type.REMOVE_CHILD:
          this.onNodeDetached(patch.child);
          return;
        case Type.UPDATE_NODE:
          this.onNodeUpdated(patch.node, patch.prevDescription);
          return;
      }
    },
  };

  loader.define('core/lifecycle', Lifecycle);
}

{
  const INIT_ROOT_COMPONENT = {
    type: Symbol('init-root-component'),
    apply: function() {
      const container =
          this.root.container ? this.root.container : this.root.shadow;
      container.appendChild(this.root.content.ref);
    },
  };
  const UPDATE_NODE = {
    type: Symbol('update-node'),
    apply: function() {
      this.node.description = this.description;
    },
  };

  const SET_ATTRIBUTE = {
    type: Symbol('set-attribute'),
    apply: function() {
      const attr = this.isCustom ?
          this.name :
          opr.Toolkit.utils.getAttributeName(this.name);
      this.target.ref.setAttribute(attr, this.value);
    },
  };
  const REMOVE_ATTRIBUTE = {
    type: Symbol('remove-attribute'),
    apply: function() {
      const attr = this.isCustom ?
          this.name :
          opr.Toolkit.utils.getAttributeName(this.name);
      this.target.ref.removeAttribute(attr);
    },
  };

  const SET_DATA_ATTRIBUTE = {
    type: Symbol('set-data-attribute'),
    apply: function() {
      this.target.ref.dataset[this.name] = this.value;
    },
  };
  const REMOVE_DATA_ATTRIBUTE = {
    type: Symbol('remove-data-attribute'),
    apply: function() {
      delete this.target.ref.dataset[this.name];
    },
  };

  const SET_STYLE_PROPERTY = {
    type: Symbol('set-style-property'),
    apply: function() {
      if (this.property.startsWith('--')) {
        this.target.ref.style.setProperty(this.property, ` ${this.value}`);
      } else {
        this.target.ref.style[this.property] = this.value;
      }
    },
  };
  const REMOVE_STYLE_PROPERTY = {
    type: Symbol('remove-style-property'),
    apply: function() {
      if (this.property.startsWith('--')) {
        this.target.ref.style.removeProperty(this.property);
      } else {
        this.target.ref.style[this.property] = null;
      }
    },
  };

  const SET_CLASS_NAME = {
    type: Symbol('set-class-name'),
    apply: function() {
      this.target.ref.className = this.className;
    },
  };

  const ADD_LISTENER = {
    type: Symbol('add-listener'),
    apply: function() {
      const event =
          this.isCustom ? this.name : opr.Toolkit.utils.getEventName(this.name);
      this.target.ref.addEventListener(event, this.listener);
    },
  };
  const REPLACE_LISTENER = {
    type: Symbol('replace-listener'),
    apply: function() {
      const event =
          this.isCustom ? this.name : opr.Toolkit.utils.getEventName(this.name);
      this.target.ref.removeEventListener(event, this.removed);
      this.target.ref.addEventListener(event, this.added);
    },
  };
  const REMOVE_LISTENER = {
    type: Symbol('remove-listener'),
    apply: function() {
      const event =
          this.isCustom ? this.name : opr.Toolkit.utils.getEventName(this.name);
      this.target.ref.removeEventListener(event, this.listener);
    },
  };

  const SET_PROPERTY = {
    type: Symbol('set-property'),
    apply: function() {
      this.target.ref[this.key] = this.value;
    },
  };
  const DELETE_PROPERTY = {
    type: Symbol('delete-property'),
    apply: function() {
      delete this.target.ref[this.key];
    },
  };

  const INSERT_CHILD = {
    type: Symbol('insert-child'),
    apply: function() {
      this.parent.insertChild(this.node, this.at);
    },
  };
  const REPLACE_CHILD = {
    type: Symbol('replace-child'),
    apply: function() {
      this.parent.replaceChild(this.child, this.node);
    },
  };
  const MOVE_CHILD = {
    type: Symbol('move-child'),
    apply: function() {
      this.parent.moveChild(this.child, this.from, this.to);
    },
  };
  const REMOVE_CHILD = {
    type: Symbol('remove-child'),
    apply: function() {
      this.parent.removeChild(this.child);
    },
  };

  const SET_CONTENT = {
    type: Symbol('set-content'),
    apply: function() {
      this.parent.setContent(this.node);
    },
  };

  const Types = {
    INIT_ROOT_COMPONENT,
    UPDATE_NODE,
    SET_ATTRIBUTE,
    REMOVE_ATTRIBUTE,
    SET_DATA_ATTRIBUTE,
    REMOVE_DATA_ATTRIBUTE,
    SET_STYLE_PROPERTY,
    REMOVE_STYLE_PROPERTY,
    SET_CLASS_NAME,
    ADD_LISTENER,
    REPLACE_LISTENER,
    REMOVE_LISTENER,
    SET_PROPERTY,
    DELETE_PROPERTY,
    INSERT_CHILD,
    REPLACE_CHILD,
    MOVE_CHILD,
    REMOVE_CHILD,
    SET_CONTENT,
  };
  const PatchTypes = Object.keys(Types).reduce((result, key) => {
    result[key] = Types[key].type;
    return result;
  }, {});

  class Patch {

    constructor(def) {
      this.type = def.type;
      this.apply = def.apply || opr.Toolkit.noop;
    }

    static initRootComponent(root) {
      const patch = new Patch(INIT_ROOT_COMPONENT);
      patch.root = root;
      return patch;
    }

    static updateNode(node, description) {
      const patch = new Patch(UPDATE_NODE);
      patch.node = node;
      patch.prevDescription = node.description;
      patch.description = description;
      return patch;
    }

    static insertChild(node, at, parent) {
      const patch = new Patch(INSERT_CHILD);
      patch.node = node;
      patch.at = at;
      patch.parent = parent;
      return patch;
    }

    static moveChild(child, from, to, parent) {
      const patch = new Patch(MOVE_CHILD);
      patch.child = child;
      patch.from = from;
      patch.to = to;
      patch.parent = parent;
      return patch;
    }

    static replaceChild(child, node, parent) {
      const patch = new Patch(REPLACE_CHILD);
      patch.child = child;
      patch.node = node;
      patch.parent = parent;
      return patch;
    }

    static removeChild(child, at, parent) {
      const patch = new Patch(REMOVE_CHILD);
      patch.child = child;
      patch.at = at;
      patch.parent = parent;
      return patch;
    }

    static setContent(node, parent) {
      const patch = new Patch(SET_CONTENT);
      patch.node = node;
      patch.child = parent.content;
      patch.parent = parent;
      return patch;
    }

    static setAttribute(name, value, target, isCustom) {
      const patch = new Patch(SET_ATTRIBUTE);
      patch.name = name;
      patch.value = value;
      patch.target = target;
      patch.isCustom = isCustom;
      return patch;
    }

    static removeAttribute(name, target, isCustom) {
      const patch = new Patch(REMOVE_ATTRIBUTE);
      patch.name = name;
      patch.target = target;
      patch.isCustom = isCustom;
      return patch;
    }

    static setDataAttribute(name, value, target) {
      const patch = new Patch(SET_DATA_ATTRIBUTE);
      patch.name = name;
      patch.value = value;
      patch.target = target;
      return patch;
    }

    static removeDataAttribute(name, target) {
      const patch = new Patch(REMOVE_DATA_ATTRIBUTE);
      patch.name = name;
      patch.target = target;
      return patch;
    }

    static setStyleProperty(property, value, target) {
      const patch = new Patch(SET_STYLE_PROPERTY);
      patch.property = property;
      patch.value = value;
      patch.target = target;
      return patch;
    }

    static removeStyleProperty(property, target) {
      const patch = new Patch(REMOVE_STYLE_PROPERTY);
      patch.property = property;
      patch.target = target;
      return patch;
    }

    static setClassName(className, target) {
      const patch = new Patch(SET_CLASS_NAME);
      patch.className = className;
      patch.target = target;
      return patch;
    }

    static addListener(name, listener, target, isCustom) {
      const patch = new Patch(ADD_LISTENER);
      patch.name = name;
      patch.listener = listener;
      patch.target = target;
      patch.isCustom = isCustom;
      return patch;
    }

    static replaceListener(name, removed, added, target, isCustom) {
      const patch = new Patch(REPLACE_LISTENER);
      patch.name = name;
      patch.removed = removed;
      patch.added = added;
      patch.target = target;
      patch.isCustom = isCustom;
      return patch;
    }

    static removeListener(name, listener, target, isCustom) {
      const patch = new Patch(REMOVE_LISTENER);
      patch.name = name;
      patch.listener = listener;
      patch.target = target;
      patch.isCustom = isCustom;
      return patch;
    }

    static setProperty(key, value, target) {
      const patch = new Patch(SET_PROPERTY);
      patch.key = key;
      patch.value = value;
      patch.target = target;
      return patch;
    }

    static deleteProperty(key, target) {
      const patch = new Patch(DELETE_PROPERTY);
      patch.key = key;
      patch.target = target;
      return patch;
    }

    static get Type() {
      return PatchTypes;
    }
  }

  loader.define('core/patch', Patch);
}

{
  /*
   * Normalized description of a template.
   * Is used to calculate differences between nodes.
   */
  class Description {

    get childrenAsTemplates() {
      if (this.children) {
        return this.children.map(child => child.asTemplate);
      }
      return undefined;
    }

    isCompatible(description) {
      return this.constructor === description.constructor;
    }
  }

  /*
   * Defines a normalized description of a component.
   *
   * Enumerable properties:
   * - key (a unique node identifier within its parent),
   * - component (an object with meta information)
   * - children (an array of child nodes)
   * - props (an object of any component rendering props)
   *
   * Non-enumerable properties:
   * - asTemplate: returns component description as a normalized template
   */
  class ComponentDescription extends Description {

    constructor(component) {
      super();
      this.component = component;
      this.type = 'component';
    }

    isCompatible(description) {
      return super.isCompatible(description) &&
          this.component === description.component;
    }

    get isRoot() {
      return this.component.prototype instanceof opr.Toolkit.Root;
    }

    get asTemplate() {
      const template = [this.component];
      if (this.props) {
        template.push(this.props);
      }
      if (this.children) {
        template.push(...this.children.map(child => child.asTemplate));
      }
      return template;
    }
  }

  /*
   * Defines a normalized description of an element.
   *
   * Enumerable properties:
   * - key (a unique node identifier within its parent),
   * - name (a string representing tag name),
   * - text (a string representing text content),
   * - children (an array of child nodes),
   * - props (an object) defining:
   *    - class (a class name string)
   *    - style (an object for style property to string value mapping)
   *    - listeners (an object for event name to listener mapping)
   *    - attrs (an object for normalized attribute name to value mapping)
   *    - dataset (an object representing data attributes)
   *    - properties (an object for properties set directly on DOM element)
   *
   * Non-enumerable properties:
   * - asTemplate: returns element description as a normalized template
   */
  class ElementDescription extends Description {

    constructor(name) {
      super();
      this.name = name;
      this.type = 'element';
    }

    isCompatible(description) {
      return super.isCompatible(description) && this.name === description.name;
    }

    get asTemplate() {
      const template = [this.name];
      const props = {};
      if (this.key) {
        props.key = this.key;
      }
      if (this.class) {
        props.class = this.class;
      }
      if (this.style) {
        props.style = this.style;
      }
      if (this.attrs) {
        Object.assign(props, this.attrs);
      }
      if (this.dataset) {
        props.dataset = this.dataset;
      }
      if (this.listeners) {
        Object.assign(props, this.listeners);
      }
      if (this.properties) {
        props.properties = this.properties;
      }
      if (Object.keys(props).length) {
        template.push(props);
      }
      if (this.children) {
        template.push(...this.children.map(child => child.asTemplate));
      } else if (typeof this.text === 'string') {
        template.push(this.text);
      }
      return template;
    }
  }

  /*
   * Description of a Comment node.
   */
  class CommentDescription extends Description {

    constructor(text) {
      super();
      this.text = text;
      this.type = 'comment';
    }

    get asTemplate() {
      return null;
    }

    isCompatible(description) {
      return super.isCompatible(description) && this.text === description.text;
    }
  }

  /*
   * Description of a Text node.
   */
  class TextDescription extends Description {

    constructor(text) {
      super();
      this.text = text;
      this.type = 'text';
    }

    get asTemplate() {
      return this.text;
    }

    isCompatible(description) {
      return super.isCompatible(description) && this.text === description.text;
    }
  }

  Object.assign(Description, {
    ElementDescription,
    ComponentDescription,
    CommentDescription,
    TextDescription,
  });

  loader.define('core/description', Description);
}

{
  const Permission = {
    LISTEN_FOR_UPDATES: 'listen-for-updates',
    REGISTER_METHOD: 'register-method',
    INJECT_STYLESHEETS: 'inject-stylesheets',
  };

  class Plugin {

    constructor(manifest) {

      opr.Toolkit.assert(
          typeof manifest.name === 'string' && manifest.name.length,
          'Plugin name must be a non-empty string!');

      Object.assign(this, manifest);
      this.origin = manifest;

      if (this.permissions === undefined) {
        this.permissions = [];
      } else {
        opr.Toolkit.assert(
            Array.isArray(this.permissions),
            'Plugin permissions must be an array');
        this.permissions = this.permissions.filter(
            permission => Object.values(Permission).includes(permission));
      }

      const sandbox = this.createSandbox();
      if (typeof manifest.register === 'function') {
        this.register = () => manifest.register(sandbox);
      }
      if (typeof manifest.install === 'function') {
        this.install = root => {
          const uninstall = manifest.install(root);
          opr.Toolkit.assert(
              typeof uninstall === 'function',
              'The plugin installation must return the uninstall function!');
          return uninstall;
        };
      }
    }

    isListener() {
      return this.permissions.includes(Permission.LISTEN_FOR_UPDATES);
    }

    isStylesheetProvider() {
      return this.permissions.includes(Permission.INJECT_STYLESHEETS);
    }

    createSandbox() {
      const sandbox = {};
      for (const permission of this.permissions) {
        switch (permission) {
          case Permission.REGISTER_METHOD:
            sandbox.registerMethod = name =>
                opr.Toolkit.Sandbox.registerPluginMethod(name);
        }
      }
      return sandbox;
    }
  }

  class Registry {

    constructor() {
      this.plugins = new Map();
      this.cache = {
        listeners: [],
      };
      this[Symbol.iterator] = () => this.plugins.values()[Symbol.iterator]();
    }

    /*
     * Adds the plugin to the registry
     */
    add(plugin) {
      opr.Toolkit.assert(
          !this.isRegistered(plugin.name),
          `Plugin '${plugin.name}' is already registered!`);
      this.plugins.set(plugin.name, plugin);
      this.updateCache();
    }

    /*
     * Removes plugin from the registry with the specified name.
     * Returns the uninstall function if present.
     */
    remove(name) {
      const plugin = this.plugins.get(name);
      opr.Toolkit.assert(
          plugin, `No plugin found with the specified name: "${name}"`);
      this.plugins.delete(name);
      this.updateCache();
      const uninstall = this.uninstalls.get(name);
      if (uninstall) {
        this.uninstalls.delete(name);
        return uninstall;
      }
      return null;
    }

    /*
     * Checks if plugin with specified name exists in the registry.
     */
    isRegistered(name) {
      return this.plugins.has(name);
    }

    /*
     * Updates the cache.
     */
    updateCache() {
      const plugins = [...this.plugins.values()];
      this.cache.listeners = plugins.filter(plugin => plugin.isListener());
    }

    /*
     * Clears the registry and the cache.
     */
    clear() {
      this.plugins.clear();
      this.uninstalls.clear();
      this.cache.listeners.length = 0;
    }
  }

  class Plugins {

    constructor(root) {
      this.root = root;
      this.registry = new Registry();
      this.uninstalls = new Map();
      this[Symbol.iterator] = () => this.registry[Symbol.iterator]();
    }

    /*
     * Creates a Plugin instance from the manifest object and registers it.
     */
    register(plugin) {
      if (!(plugin instanceof Plugin)) {
        plugin = new Plugin(plugin);
      }
      if (plugin.register) {
        plugin.register();
      }
      this.registry.add(plugin);
    }

    installAll() {
      for (const plugin of this.registry) {
        this.install(plugin);
      }
    }

    install(plugin) {
      if (this.root && plugin.install) {
        const uninstall = plugin.install(this.root);
        this.uninstalls.set(plugin.name, uninstall);
      }
    }

    /*
     * Removes the plugin from the registry and invokes it's uninstall method
     * if present.
     */
    uninstall(name) {
      const uninstall = this.uninstalls.get(name);
      if (uninstall) {
        uninstall();
      }
    }

    /*
     * Uninstalls all the plugins from the registry.
     */
    async destroy() {
      for (const plugin of this.registry) {
        this.uninstall(plugin.name);
      }
      this.root = null;
    }

    /*
     * Invokes listener methods on registered listener plugins.
     */
    notify(action, event) {
      switch (action) {
        case 'before-update':
          for (const listener of this.registry.cache.listeners) {
            listener.onBeforeUpdate(event);
          }
          return;
        case 'after-update':
          for (const listener of this.registry.cache.listeners) {
            listener.onAfterUpdate(event);
          }
          return;
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    }
  }

  Plugins.Plugin = Plugin;

  loader.define('core/plugins', Plugins);
}

{
  const Name = {
    INSERT: Symbol('insert'),
    MOVE: Symbol('move'),
    REMOVE: Symbol('remove'),
  };

  class Move {

    constructor(name, item, props, make) {
      this.name = name;
      this.item = item;
      this.at = props.at;
      this.from = props.from;
      this.to = props.to;
      this.make = make;
    }

    static insert(item, at) {
      return new Move(Name.INSERT, item, {at}, items => {
        items.splice(at, 0, item);
      });
    }

    static move(item, from, to) {
      return new Move(Name.MOVE, item, {from, to}, items => {
        items.splice(from, 1);
        items.splice(to, 0, item);
      });
    }

    static remove(item, at) {
      return new Move(Name.REMOVE, item, {at}, items => {
        items.splice(at, 1);
      });
    }
  }

  const Reconciler = {

    comparator(a, b) {
      if (Object.is(a.key, b.key)) {
        return 0;
      }
      return a.key > b.key ? 1 : -1;
    },

    calculateMoves(source, target, favoredToMove = null) {
      const moves = [];

      const createItem = function(key, index) {
        return ({key, index});
      };

      const before = source.map(createItem).sort(this.comparator);
      const after = target.map(createItem).sort(this.comparator);

      let removed = [];
      let inserted = [];

      while (before.length || after.length) {
        if (!before.length) {
          inserted = inserted.concat(after);
          break;
        }
        if (!after.length) {
          removed = removed.concat(before);
          break;
        }
        const result = this.comparator(after[0], before[0]);
        if (result === 0) {
          before.shift();
          after.shift();
        } else if (result === 1) {
          removed.push(before.shift());
        } else {
          inserted.push(after.shift());
        }
      }

      const sortByIndex = function(foo, bar) {
        return foo.index - bar.index;
      };

      removed.sort(sortByIndex).reverse();
      inserted.sort(sortByIndex);

      const result = [...source];

      for (let item of removed) {
        const move = Move.remove(item.key, item.index);
        move.make(result);
        moves.push(move);
      }
      for (let item of inserted) {
        const move = Move.insert(item.key, item.index);
        move.make(result);
        moves.push(move);
      }

      if (opr.Toolkit.Diff.deepEqual(result, target)) {
        moves.result = result;
        return moves;
      }

      const calculateIndexChanges = (source, target, reversed = false) => {

        const moves = [];

        const moveItemIfNeeded = index => {
          const item = target[index];
          if (source[index] !== item) {
            const from = source.indexOf(item);
            const move = Move.move(item, from, index);
            move.make(source);
            moves.push(move);
          }
        };

        if (reversed) {
          for (let i = target.length - 1; i >= 0; i--) {
            moveItemIfNeeded(i);
          }
        } else {
          for (let i = 0; i < target.length; i++) {
            moveItemIfNeeded(i);
          }
        }
        moves.result = source;
        return moves;
      };

      const defaultMoves = calculateIndexChanges([...result], target);
      if (defaultMoves.length > 1 ||
          favoredToMove && defaultMoves.length === 1 &&
              defaultMoves[0].item !== favoredToMove) {
        const alternativeMoves =
            calculateIndexChanges([...result], target, /*= reversed */ true);
        if (alternativeMoves.length <= defaultMoves.length) {
          moves.push(...alternativeMoves);
          moves.result = alternativeMoves.result;
          return moves;
        }
      }
      moves.push(...defaultMoves);
      moves.result = defaultMoves.result;
      return moves;
    },
  };

  Reconciler.Move = Move;
  Reconciler.Move.Name = Name;

  loader.define('core/reconciler', Reconciler);
}

{
  const Renderer = {

    /*
     * Calls the component render method and transforms the returned template
     * into the normalised description of the rendered node.
     */
    render(component, props = {}, children = []) {
      component.sandbox.props = props;
      component.sandbox.children = children;
      const template = component.render.call(component.sandbox);
      if (template) {
        return opr.Toolkit.Template.describe(template);
      }
      const text = component.constructor.displayName;
      return new opr.Toolkit.Description.CommentDescription(text);
    },

    /*
     * Updates the Web component and patches the DOM tree
     * to match the new component state.
     */
    update(root, from, to, command) {

      const update = {
        command,
        root,
        state: {
          from,
          to,
        },
      };

      this.onBeforeUpdate(update, root);

      const diff = new opr.Toolkit.Diff(root, from, to);
      update.patches = diff.apply();

      this.onAfterUpdate(update, root);
    },

    /*
     * Notifies the observers about upcoming update.
     */
    onBeforeUpdate(update, root) {
      root.plugins.notify('before-update', update);
    },

    /*
     * Notifies the observers about completed update.
     */
    onAfterUpdate(update, root) {
      root.plugins.notify('after-update', update);
    },

    /**
     * Creates a new Custom Element instance assigned to specifed Web Component.
     */
    createCustomElement(root) {
      const defineCustomElementClass = RootClass => {
        let ElementClass = customElements.get(RootClass.elementName);
        if (!ElementClass) {
          ElementClass = class RootElement extends ComponentElement {};
          customElements.define(RootClass.elementName, ElementClass);
          RootClass.prototype.elementClass = ElementClass;
        }
        return ElementClass;
      };
      const ElementClass = defineCustomElementClass(root.constructor);
      const element = new ElementClass(root);
      if (root.description.attrs) {
        const attrs = Object.entries(root.description.attrs);
        for (const [name, value] of attrs) {
          element.setAttribute(name, value);
        }
      }
      return element;
    },

    /*
     * Creates a new DOM Element based on the specified description.
     */
    createElement(description) {
      const element = document.createElement(description.name);
      if (description.text) {
        element.textContent = description.text;
      }
      if (description.class) {
        element.className = description.class;
      }
      if (description.style) {
        for (const [prop, value] of Object.entries(description.style)) {
          if (prop.startsWith('--')) {
            element.style.setProperty(prop, ` ${value}`);
          } else {
            element.style[prop] = value;
          }
        }
      }
      if (description.listeners) {
        for (const [name, listener] of Object.entries(description.listeners)) {
          const event = opr.Toolkit.utils.getEventName(name);
          element.addEventListener(event, listener);
        }
      }
      if (description.attrs) {
        for (const [attr, value] of Object.entries(description.attrs)) {
          const name = opr.Toolkit.utils.getAttributeName(attr);
          element.setAttribute(name, value);
        }
      }
      if (description.dataset) {
        for (const [attr, value] of Object.entries(description.dataset)) {
          element.dataset[attr] = value;
        }
      }
      if (description.properties) {
        for (const [prop, value] of Object.entries(description.properties)) {
          element[prop] = value;
        }
      }
      if (description.custom) {
        if (description.custom.attrs) {
          const customAttributes = Object.entries(description.custom.attrs);
          for (const [name, value] of customAttributes) {
            element.setAttribute(name, value);
          }
        }
        if (description.custom.listeners) {
          const customListeners = Object.entries(description.custom.listeners);
          for (const [event, listener] of customListeners) {
            element.addEventListener(event, listener);
          }
        }
      }
      return element;
    },
  };

  const cssImports = paths =>
      paths.map(loader.path).map(path => `@import url(${path});`).join('\n');

  class ComponentElement extends HTMLElement {

    constructor(root) {

      super();
      this.$root = root;

      addPluginsAPI(this);

      root.shadow = this.attachShadow({
        mode: 'open',
      });

      const stylesheets = root.getStylesheets();

      const onSuccess = () => {
        root.init();
      };

      if (stylesheets && stylesheets.length) {
        const imports = cssImports(stylesheets);
        const onError = () => {
          throw new Error(
              `Error loading stylesheets: ${stylesheets.join(', ')}`);
        };
        const style = document.createElement('style');
        style.textContent = imports;
        style.onload = onSuccess;
        style.onerror = onError;
        root.shadow.appendChild(style);
      } else {
        onSuccess();
      }
    }

    get isComponentElement() {
      return true;
    }

    connectedCallback() {
      clearTimeout(this.pendingDestruction);
    }

    disconnectedCallback() {
      this.pendingDestruction = setTimeout(() => this.destroy(), 50);
    }

    destroy() {
      const Lifecycle = opr.Toolkit.Lifecycle;
      const root = this.$root;
      Lifecycle.onComponentDestroyed(root);
      Lifecycle.onComponentDetached(root);
      root.ref = null;
      this.$root = null;
    }
  }

  const addPluginsAPI = element => {
    const {
      Plugin,
    } = opr.Toolkit.Plugins;
    element.install = (plugin, cascade = true) => {
      const installTo = root => {
        if (plugin instanceof Plugin) {
          root.plugins.use(plugin);
        } else {
          root.plugins.install(plugin);
        }
        if (cascade) {
          for (const subroot of root.subroots) {
            installTo(subroot);
          }
        }
      };
      installTo(element.$root);
    };
    element.uninstall = (plugin, cascade = true) => {
      const name = typeof plugin === 'string' ? plugin : plugin.name;
      const uninstallFrom = root => {
        root.plugins.uninstall(name);
        if (cascade) {
          for (const subroot of root.subroots) {
            uninstallFrom(subroot);
          }
        }
      };
      uninstallFrom(element.$root);
    };
  };

  loader.define('core/renderer', Renderer);
}

{
  const isFunction = (target, property) =>
      typeof target[property] === 'function';

  const delegated = [
    'commands',
    'constructor',
    'container',
    'dispatch',
    'elementName',
  ];
  const methods = [
    'connectTo',
  ];
  const pluginMethods = [];

  const createBoundListener = (listener, component, context) => {
    const boundListener = listener.bind(context);
    boundListener.source = listener;
    boundListener.component = component;
    return boundListener;
  };

  class Sandbox {

    static registerPluginMethod(name) {
      pluginMethods.push(name);
    }

    static create(component) {
      const blacklist =
          Object.getOwnPropertyNames(opr.Toolkit.Component.prototype);
      const state = {};
      const autobound = {};
      return new Proxy(component, {
        get: (target, property, receiver) => {
          if (property === 'props') {
            return state.props || target.state || {};
          }
          if (property === 'children') {
            return state.children || [];
          }
          if (property === 'host') {
            return target.isRoot() ? target.shadow.host : null;
          }
          if (property === 'ref') {
            if (target.isRoot()) {
              // returns rendered node instead of custom element for usage of
              // this.ref.querySelector
              return target.content.ref;
            }
            return target.ref;
          }
          if (property === '$component') {
            return component;
          }
          if (delegated.includes(property)) {
            return target[property];
          }
          if (methods.includes(property) && isFunction(target, property)) {
            return createBoundListener(target[property], target, target);
          }
          if (pluginMethods.includes(property)) {
            return target.rootNode[property];
          }
          if (blacklist.includes(property)) {
            return undefined;
          }
          if (isFunction(autobound, property)) {
            return autobound[property];
          }
          if (isFunction(target, property)) {
            return autobound[property] =
                       createBoundListener(target[property], target, receiver);
          }
          return target[property];
        },
        set: (target, property, value) => {
          if (property === 'props') {
            state.props = value;
            return true;
          }
          if (property === 'children') {
            state.children = value || [];
            return true;
          }
          return false;
        },
      });
    }
  }

  loader.define('core/sandbox', Sandbox);
}

{
  class Service {

    static validate(listeners) {
      if (opr.Toolkit.isDebug()) {
        // clang-format off
        /* eslint-disable max-len */
        const keys = Object.keys(listeners);
        opr.Toolkit.assert(
            this.events instanceof Array,
            `Service "${this.name}" does not provide information about valid events, implement "static get events() { return ['foo', 'bar']; }"`);
        opr.Toolkit.assert(
            this.events.length > 0,
            `Service "${this.name}" returned an empty list of valid events, the list returned from "static get event()" must contain at least one event name`);
        const unsupportedKeys =
            Object.keys(listeners).filter(key => !this.events.includes(key));
        for (const unsupportedKey of unsupportedKeys) {
          opr.Toolkit.warn(
              `Unsupported listener specified "${unsupportedKey}" when connecting to ${this.name}`);
        }
        const supportedKeys = this.events.filter(event => keys.includes(event));
        opr.Toolkit.assert(
            supportedKeys.length > 0,
            `No valid listener specified when connecting to ${this.name}, use one of [${this.events.join(', ')}]`);
        for (const supportedKey of supportedKeys) {
          opr.Toolkit.assert(
              listeners[supportedKey] instanceof Function,
              `Specified listener "${supportedKey}" for ${this.name} is not a function`);
        }
        /* eslint-enable max-len */
        // clang-format on
      }
      return this.events.filter(event => listeners[event] instanceof Function);
    }
  }

  loader.define('core/service', Service);
}

{
  const SET_STATE = Symbol('set-state');
  const UPDATE = Symbol('update');

  const coreReducer = (state, command) => {
    if (command.type === SET_STATE) {
      return command.state;
    }
    if (command.type === UPDATE) {
      return {
        ...state,
        ...command.state,
      };
    }
    return state;
  };

  coreReducer.commands = {
    setState: state => ({
      type: SET_STATE,
      state,
    }),
    update: state => ({
      type: UPDATE,
      state,
    }),
  };

  class Reducers {

    static combine(...reducers) {
      const commands = {};
      const reducer = (state, command) => {
        for (const reducer of [coreReducer, ...reducers]) {
          state = reducer(state, command);
        }
        return state;
      };
      for (const reducer of [coreReducer, ...reducers]) {
        const defined = Object.keys(commands);
        const incoming = Object.keys(reducer.commands);

        const overriden = incoming.find(key => defined.includes(key));
        if (overriden) {
          console.error(
              'Reducer:', reducer,
              `conflicts an with exiting one with method: "${overriden}"`);
          throw new Error(`The "${overriden}" command is already defined!`);
        }
        Object.assign(commands, reducer.commands);
      }
      reducer.commands = commands;
      return reducer;
    }
  }

  loader.define('core/reducers', Reducers);
}

{
  const isDefined = value => value !== undefined && value !== null;
  const isFalsy = template => template === null || template === false;
  const isNotEmpty = object => Boolean(Object.keys(object).length);

  const Template = {

    /*
     * Creates a normalized Description of given template.
     */
    describe(template) {

      if (isFalsy(template)) {
        return null;
      }

      if (Array.isArray(template) && template.length) {

        const {
          ComponentDescription,
          ElementDescription,
          TextDescription,
        } = opr.Toolkit.Description;

        let description;
        for (const [item, type, index] of template.map(
                 (item, index) => [item, this.getItemType(item), index])) {
          if (index === 0) {
            switch (type) {
              case 'string':
                description = new ElementDescription(item);
                break;
              case 'component':
              case 'function':
              case 'symbol':
                description = new ComponentDescription(
                    opr.Toolkit.resolveComponentClass(item, type));
                break;
              default:
                console.error(
                    'Invalid node type:', item,
                    `(${type}) at index: ${index}, template:`, template);
                throw new Error(`Invalid node type specified: ${type}`);
            }
            continue;
          }
          if (index === 1 && type === 'props') {
            if (description.type === 'component') {
              this.assignPropsToComponent(item, description);
            } else if (description.type === 'element') {
              this.assignPropsToElement(item, description);
            }
            continue;
          }
          if (isFalsy(item)) {
            continue;
          }
          if (type === 'string' || type === 'number' || item === true) {
            description.children = description.children || [];
            description.children.push(new TextDescription(String(item)));
            continue;
          } else if (type === 'node') {
            description.children = description.children || [];
            description.children.push(this.describe(item));
          } else {
            console.error(
                'Invalid item', item, `at index: ${index}, template:`,
                template);
            throw new Error(`Invalid item specified: ${type}`);
          }
        }

        if (opr.Toolkit.isDebug()) {
          opr.Toolkit.utils.deepFreeze(description);
        }
        return description;
      }

      console.error('Invalid template definition:', template);
      throw new Error('Expecting array, null or false');
    },

    /*
     * Returns a new props object supplemented by overriden values.
     */
    normalizeProps(...overrides) {
      const result = {};
      for (const override of overrides) {
        for (const [key, value] of Object.entries(override || {})) {
          if (result[key] === undefined && value !== undefined) {
            result[key] = value;
          }
        }
      }
      return result;
    },

    /*
     * Normalizes specified element props object and returns either
     * a non-empty object containing only supported props or null.
     */
    normalizeComponentProps(props, ComponentClass) {
      return this.normalizeProps(props, ComponentClass.defaultProps || {});
    },

    assignPropsToComponent(object, description) {
      const props = this.getComponentProps(
          object, description.component, description.isRoot);
      if (props) {
        description.props = props;
        if (isDefined(props.key)) {
          description.key = String(props.key);
        }
        if (props.attrs) {
          const attrs = this.getCustomAttributes(props.attrs, true);
          if (attrs) {
            description.attrs = attrs;
          }
        }
      }
    },

    getComponentProps(object, ComponentClass, isRoot) {
      const props = isRoot ?
          object :
          this.normalizeComponentProps(object, ComponentClass);
      return isNotEmpty(props) ? props : null;
    },

    assignPropsToElement(props, description) {
      for (const [key, value] of Object.entries(props)) {
        if (key === 'key') {
          if (isDefined(value)) {
            description.key = String(value);
          }
        } else if (key === 'class') {
          const className = this.getClassName(value);
          if (className) {
            description.class = className;
          }
        } else if (key === 'style') {
          const style = this.getStyle(value);
          if (style) {
            description.style = style;
          }
        } else if (key === 'dataset') {
          const dataset = this.getDataset(value);
          if (dataset) {
            description.dataset = dataset;
          }
        } else if (key === 'properties') {
          const properties = this.getProperties(value);
          if (properties) {
            description.properties = properties;
          }
        } else if (key === 'attrs') {
          const customAttrs = this.getCustomAttributes(value);
          if (customAttrs) {
            description.custom = description.custom || {};
            description.custom.attrs = customAttrs;
          }
        } else if (key === 'on') {
          const customListeners = this.getCustomListeners(value);
          if (customListeners) {
            description.custom = description.custom || {};
            description.custom.listeners = customListeners;
          }
        } else {

          const {
            isAttributeSupported,
            isAttributeValid,
            getValidElementNamesFor,
            isEventSupported,
          } = opr.Toolkit.Browser;

          if (isAttributeSupported(key)) {
            const attr = this.getAttributeValue(value);
            if (isDefined(attr)) {
              description.attrs = description.attrs || {};
              description.attrs[key] = attr;
            }
            if (opr.Toolkit.isDebug()) {
              const element = description.name;
              if (attr === undefined) {
                console.warn(
                    `Invalid undefined value for attribute "${key}"`,
                    `on element "${element}".`);
              }
              if (!element.includes('-') && !isAttributeValid(key, element)) {
                const names = getValidElementNamesFor(key)
                                  .map(key => `"${key}"`)
                                  .join(', ');
                const message =
                    `The "${key}" attribute is not supported on "${
                                                                   element
                                                                 }" elements.`;
                const hint = `Use one of ${names}.`;
                console.warn(message, hint);
              }
            }
          } else if (isEventSupported(key)) {
            const listener = this.getListener(value, key);
            if (listener) {
              description.listeners = description.listeners || {};
              description.listeners[key] = value;
            }
          } else {
            console.warn(
                `Unsupported property "${key}" on element "${
                                                             description.name
                                                           }".`);
          }
        }
      }
    },

    /*
     * Returns the type of item used in the array representing node template.
     */
    getItemType(item) {
      const type = typeof item;
      switch (type) {
        case 'function':
          if (item.prototype instanceof opr.Toolkit.Component) {
            return 'component';
          }
          return 'function';
        case 'object':
          if (item === null) {
            return 'null';
          } else if (Array.isArray(item)) {
            return 'node';
          } else if (item.constructor === Object) {
            return 'props';
          }
          return 'unknown';
        default:
          return type;
      }
    },

    /*
     * Resolves any object to a space separated string of class names.
     */
    getClassName(value) {
      if (!value) {
        return '';
      }
      if (typeof value === 'string') {
        return value;
      }
      if (Array.isArray(value)) {
        return value
            .reduce(
                (result, item) => {
                  if (!item) {
                    return result;
                  }
                  if (typeof item === 'string') {
                    result.push(item);
                    return result;
                  }
                  result.push(this.getClassName(item));
                  return result;
                },
                [])
            .filter(item => item)
            .join(' ');
      }
      if (typeof value === 'object') {
        const keys = Object.keys(value);
        if (keys.length === 0) {
          return '';
        }
        return Object.keys(value)
            .map(key => value[key] && key)
            .filter(item => item)
            .join(' ');
      }
      throw new Error(`Invalid value: ${JSON.stringify(value)}`);
    },

    /*
     * Returns either a non-empty style object containing only understood
     * styling rules or null.
     */
    getStyle(object) {

      opr.Toolkit.assert(
          object.constructor === Object, 'Style must be a plain object!');

      const reduceToNonEmptyValues = (style, [name, value]) => {
        const string = this.getStyleProperty(value, name);
        if (isDefined(string)) {
          style[name] = string;
        }
        return style;
      };

      const entries = Object.entries(object);

      if (opr.Toolkit.isDebug()) {
        for (const [key, value] of entries.filter(
                 ([key]) => !opr.Toolkit.Browser.isStyleSupported(key))) {
          console.warn(
              `Unsupported style property, key: ${key}, value:`, value);
        }
      }

      const style =
          Object.entries(object)
              .filter(
                  ([key, value]) => opr.Toolkit.Browser.isStyleSupported(key))
              .reduce(reduceToNonEmptyValues, {});
      return isNotEmpty(style) ? style : null;
    },

    getStyleProperty(value, name) {
      if (typeof value === 'string') {
        return value || '\'\'';
      } else if ([true, false, null, undefined].includes(value)) {
        return null;
      } else if (Array.isArray(value)) {
        return value.join('');
      } else if (typeof value === 'number') {
        return String(value);
      } else if (typeof value === 'object') {
        let whitelist;
        if (name === 'filter') {
          whitelist = opr.Toolkit.Browser.SUPPORTED_FILTERS;
        } else if (name === 'transform') {
          whitelist = opr.Toolkit.Browser.SUPPORTED_TRANSFORMS;
        } else {
          throw new Error(`Unknown function list: ${JSON.stringify(value)}`);
        }
        return this.getFunctionList(value, whitelist);
      }
      throw new Error(`Invalid style property value: ${JSON.stringify(value)}`);
    },

    /*
     * Returns a multi-property string value.
     */
    getFunctionList(object, whitelist) {
      const composite = {};
      let entries = Object.entries(object);
      if (whitelist) {
        entries = entries.filter(([key, value]) => whitelist.includes(key));
      }
      for (const [key, value] of entries) {
        const stringValue =
            this.getAttributeValue(value, /*= allowEmpty */ false);
        if (isDefined(stringValue)) {
          composite[key] = stringValue;
        }
      }
      return Object.entries(composite)
          .map(([key, value]) => `${key}(${value})`)
          .join(' ');
    },

    getListener(value, name) {
      if (typeof value === 'function') {
        return value;
      }
      if (value === null || value === false || value === undefined) {
        return null;
      }
      throw new Error(`Invalid listener specified for event: ${name}`);
    },

    /*
     * Resolves given value to a string.
     */
    getAttributeValue(value, allowEmpty = true) {
      if (value === true || value === '') {
        return allowEmpty ? '' : null;
      } else if (typeof value === 'string') {
        return value;
      } else if (value === null || value === false) {
        return null;
      } else if (value === undefined) {
        return undefined;
      } else if (Array.isArray(value)) {
        return value.join('');
      } else if (['object', 'function', 'symbol'].includes(typeof value)) {
        throw new Error(`Invalid attribute value: ${JSON.stringify(value)}!`);
      }
      return String(value);
    },

    /*
     * Returns either a non-empty dataset object or null.
     */
    getDataset(object) {
      const dataset = {};
      for (const key of Object.keys(object)) {
        const value = this.getAttributeValue(object[key]);
        if (isDefined(value)) {
          dataset[key] = value;
        }
      }
      return isNotEmpty(dataset) ? dataset : null;
    },

    /*
     * Returns either a non-empty object containing properties set
     * directly on a rendered DOM Element or null.
     */
    getProperties(object) {
      return isNotEmpty(object) ? object : null;
    },

    getCustomAttributes(object, forComponent) {
      console.assert(
          object.constructor === Object,
          'Expecting object for custom attributes!');
      const attrs = {};
      for (const [key, value] of Object.entries(object)) {
        const attr = this.getAttributeValue(value, /*= allowEmpty */ true);
        if (isDefined(attr)) {
          const name = forComponent ? opr.Toolkit.utils.lowerDash(key) : key;
          attrs[name] = attr;
        }
      }
      return isNotEmpty(attrs) ? attrs : null;
    },

    getCustomListeners(object) {
      console.assert(
          object.constructor === Object,
          'Expecting object for custom listeners!');
      const listeners = {};
      for (const [key, value] of Object.entries(object)) {
        const listener = this.getListener(value, key);
        if (listener) {
          listeners[key] = listener;
        }
      }
      return isNotEmpty(listeners) ? listeners : null;
    },
  };

  loader.define('core/template', Template);
}

{
  const VirtualDOM = {

    /*
     * Creates a new Virtual DOM structure from given description.
     */
    createFromDescription(description, parent, context) {
      if (!description) {
        return null;
      }
      switch (description.type) {
        case 'component':
          return this.createComponent(description, parent, context);
        case 'element':
          return new opr.Toolkit.VirtualElement(description, parent, context);
        case 'comment':
          return new opr.Toolkit.Comment(description, parent);
        case 'text':
          return new opr.Toolkit.Text(description, parent);
        default:
          throw new Error(`Unsupported node type: ${description.type}`);
      }
    },

    /*
     * Creates a new component instance from given description.
     */
    createComponent(description, parent, context) {
      const ComponentClass = description.component;
      if (ComponentClass.prototype instanceof opr.Toolkit.WebComponent) {
        return this.createWebComponent(
            description, parent && parent.rootNode, context,
            /*= requireCustomElement */ true);
      }
      const component = new ComponentClass(description, parent, context);
      const nodeDescription = opr.Toolkit.Renderer.render(
          component, description.props, description.childrenAsTemplates);
      component.content =
          this.createFromDescription(nodeDescription, component, context);
      return component;
    },

    /*
     * Creates a new Web Component instance from given description.
     */
    createWebComponent(
        description, parent, context, requireCustomElement = false) {
      try {
        const ComponentClass = description.component;
        if (requireCustomElement && !ComponentClass.elementName) {
          throw new Error(`Root component "${
              ComponentClass
                  .displayName}" does not define custom element name!`);
        }
        return new ComponentClass(description, parent, context);
      } catch (error) {
        console.error('Error rendering root component:', description);
        throw error;
      }
    },
  };

  loader.define('core/virtual-dom', VirtualDOM);
}

{
  const throttle = (fn, wait = 200, delayFirstEvent = false) => {

    let lastTimestamp = 0;
    let taskId = null;

    let context;
    let params;

    return function throttled(...args) {
      /* eslint-disable no-invalid-this */
      if (!taskId) {
        const timestamp = Date.now();
        const elapsed = timestamp - lastTimestamp;
        const scheduleTask = delay => {
          taskId = setTimeout(() => {
            taskId = null;
            lastTimestamp = Date.now();
            return fn.call(context, ...params);
          }, delay);
        };
        if (elapsed >= wait) {
          lastTimestamp = timestamp;
          if (!delayFirstEvent) {
            return fn.call(this, ...args);
          }
          scheduleTask(wait);
        } else {
          scheduleTask(wait - elapsed);
        }
      }
      context = this;
      params = args;
      /* eslint-enable no-invalid-this */
    };
  };

  const debounce = (fn, wait = 200, leading = false) => {

    let taskId = null;

    let context;
    let params;

    return function debounced(...args) {
      const isFirstInvocation = !taskId;
      if (taskId) {
        clearTimeout(taskId);
      }
      taskId = setTimeout(() => {
        taskId = null;
        return fn.call(context, ...params);
      }, wait);

      context = this; // eslint-disable-line no-invalid-this
      params = args;

      if (isFirstInvocation && leading) {
        return fn.call(context, ...params);
      }
    };
  };

  const addDataPrefix = attr => `data${attr[0].toUpperCase()}${attr.slice(1)}`;

  const createUUID = () => {
    const s4 = () =>
        Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1);
    return `${s4()}${s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
  };

  const lowerDash = name =>
      name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

  const getAttributeName = key => {
    if (key === 'acceptCharset' || key === 'httpEquiv') {
      return lowerDash(key);
    } else if (key.startsWith('aria')) {
      return `aria-${key.slice(4).toLowerCase()}`;
    }
    return key.toLowerCase();
  };

  const getEventName = key =>
      key === 'onDoubleClick' ? 'dblclick' : key.slice(2).toLowerCase();

  const isSpecialProperty =
      prop => ['key', 'class', 'style', 'dataset', 'properties'].includes(prop);

  const isSupportedAttribute = attr => isSpecialProperty(attr) ||
      opr.Toolkit.Browser.isAttributeSupported(attr) ||
      opr.Toolkit.Browser.isEventSupported(attr);

  const postRender = fn => {

    // since Chromium 64 there are some problems with animations not being
    // triggered correctly, this hack solves the problem across all OS-es

    /* eslint-disable prefer-arrow-callback */
    requestAnimationFrame(function() {
      requestAnimationFrame(fn);
    });
    /* eslint-enable prefer-arrow-callback */
  };

  const deepFreeze = obj => {
    if (obj === null || typeof obj !== 'object' || Object.isFrozen(obj)) {
      // functions are intentionally not frozen
      return obj;
    }
    Object.freeze(obj);
    for (const property of Object.getOwnPropertyNames(obj)) {
      deepFreeze(obj[property]);
    }
    return obj;
  };

  const Utils = {
    throttle,
    debounce,
    addDataPrefix,
    lowerDash,
    getAttributeName,
    getEventName,
    createUUID,
    isSupportedAttribute,
    isSpecialProperty,
    postRender,
    deepFreeze,
  };

  loader.define('core/utils', Utils);
}

{
  const INIT = Symbol('init');

  /* Function to Component mapping. */
  const pureComponentClassRegistry = new Map();

  class Toolkit {

    constructor() {
      this.roots = new Set();
      this.settings = null;
      this.ready = new Promise(resolve => {
        this[INIT] = resolve;
      });
      this.assert = console.assert;
    }

    /*
     * Configures Toolkit with given options object.
     */
    async configure(options) {
      const settings = {};
      settings.debug = options.debug || false;
      Object.freeze(settings);
      this.settings = settings;
      this.plugins = this.createPlugins(options.plugins);
      this[INIT](true);
    }

    import(path) {
      const modulePath = loader.path(path);
      return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = modulePath;
        script.type = 'module';
        script.onload = () => {
          resolve();
        };
        script.onerror = error => {
          reject(error);
        };
        document.head.appendChild(script);
      });
    }

    /*
     * Resets Toolkit to a pristine state. All future render requests
     * will require new configuration to be provided first.
     */
    reset() {
      this.plugins.destroy();
      this.plugins = null;
      this.roots.clear();
      this.settings = null;
      pureComponentClassRegistry.clear();
      this.ready = new Promise(resolve => {
        this[INIT] = resolve;
      });
    }

    createPlugins(manifests = []) {
      const plugins = new opr.Toolkit.Plugins(null);
      for (const manifest of manifests) {
        plugins.register(manifest);
      }
      return plugins;
    }

    /*
     * Returns resolved Component class.
     */
    resolveComponentClass(component, type) {
      switch (type) {
        case 'component':
          return component;
        case 'function':
          return this.resolvePureComponentClass(component);
        case 'symbol':
          return this.resolveLoadedClass(String(component).slice(7, -1));
        default:
          throw new Error(`Unsupported component type: ${type}`);
      }
    }

    /*
     * Returns a PureComponent class rendering the template
     * provided by the specified function.
     */
    resolvePureComponentClass(fn) {
      let ComponentClass = pureComponentClassRegistry.get(fn);
      if (ComponentClass) {
        return ComponentClass;
      }
      ComponentClass = class PureComponent extends opr.Toolkit.Component {
        render() {
          fn.bind(this)(this.props);
        }
      };
      ComponentClass.renderer = fn;
      pureComponentClassRegistry.set(fn, ComponentClass);
      return ComponentClass;
    }

    /*
     * Returns a component class resolved by module loader
     * with the specified id.
     */
    resolveLoadedClass(id) {
      const ComponentClass = loader.get(id);
      if (!ComponentClass) {
        throw new Error(`Error resolving component class for '${id}'`);
      }
      if (!(ComponentClass.prototype instanceof opr.Toolkit.Component)) {
        console.error(
            'Module:', ComponentClass,
            'is not a component extending opr.Toolkit.Component!');
        throw new Error(
            `Module defined with id "${id}" is not a component class.`);
      }
      return ComponentClass;
    }

    track(root) {
      if (root.parentNode) {
        const parentRootNode = root.parentNode.rootNode;
        parentRootNode.subroots.add(root);
        root.stopTracking = () => {
          parentRootNode.subroots.delete(root);
        };
      } else {
        this.roots.add(root);
        root.stopTracking = () => {
          this.roots.delete(root);
        };
      }
    }

    get tracked() {
      const tracked = [];
      for (const root of this.roots) {
        tracked.push(root, ...root.tracked);
      }
      return tracked;
    }

    isDebug() {
      return Boolean(this.settings && this.settings.debug);
    }

    warn(...messages) {
      if (this.isDebug()) {
        console.warn(...messages);
      }
    }

    async createRoot(component, props = {}) {
      if (typeof component === 'string') {
        const RootClass = await loader.preload(component);
        const description = opr.Toolkit.Template.describe([
          RootClass,
          props,
        ]);
        if (RootClass.prototype instanceof opr.Toolkit.WebComponent) {
          return opr.Toolkit.VirtualDOM.createWebComponent(description, null);
        }
        console.error(
            'Specified class is not a WebComponent: ', ComponentClass);
        throw new Error('Invalid Web Component class!');
      }
      const description = opr.Toolkit.Template.describe([
        component,
        props,
      ]);
      return opr.Toolkit.VirtualDOM.createWebComponent(description, null);
    }

    async render(component, container, props = {}) {
      await this.ready;
      const root = await this.createRoot(component, props);
      return root.mount(container);
    }
  }

  loader.define('core/toolkit', Toolkit);
}

{
  const Toolkit = loader.get('core/toolkit');
  const nodes = loader.get('core/nodes');

  Object.assign(Toolkit.prototype, nodes, {
    Browser: loader.get('core/browser'),
    Description: loader.get('core/description'),
    Diff: loader.get('core/diff'),
    Dispatcher: loader.get('core/dispatcher'),
    Lifecycle: loader.get('core/lifecycle'),
    Patch: loader.get('core/patch'),
    Plugins: loader.get('core/plugins'),
    Reconciler: loader.get('core/reconciler'),
    Renderer: loader.get('core/renderer'),
    Sandbox: loader.get('core/sandbox'),
    Service: loader.get('core/service'),
    Reducers: loader.get('core/reducers'),
    Template: loader.get('core/template'),
    VirtualDOM: loader.get('core/virtual-dom'),
    utils: loader.get('core/utils'),
    noop: () => {},
  });

  const scope = typeof window === 'undefined' ? global : window;
  scope.opr = scope.opr || {};
  scope.opr.Toolkit = new Toolkit();
}
