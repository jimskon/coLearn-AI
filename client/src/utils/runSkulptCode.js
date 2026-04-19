export async function runSkulptCode({
  code,
  fileContents,
  setOutput,
  setFileContents,
  execLimit = 50000,
  // NEW (all optional): when present, enables turtle drawing
  turtleTargetId = null,
  turtleWidth = 600,
  turtleHeight = 400,
  // 👇 NEW: callback that lets the caller broadcast file writes
  onFileWrite = null,
  stdin = null,
}) {
  setOutput('');
  console.log("[runSkulptCode] stdin =", stdin);

  if (!window.Sk || !Sk.configure) {
    setOutput('❌ Skulpt not loaded');
    return;
  }

  const filesMap = fileContents || {};

  // 🔑 NEW: used for `import foo` → Sk.read("foo.py")
  function readFromVfs(filename) {
    // Exact match in our virtual files
    if (Object.prototype.hasOwnProperty.call(filesMap, filename)) {
      return String(filesMap[filename]);
    }

    // Try adding .py if missing
    if (!filename.endsWith('.py')) {
      const alt = filename + '.py';
      if (Object.prototype.hasOwnProperty.call(filesMap, alt)) {
        return String(filesMap[alt]);
      }
    }

    // Fallback to Skulpt builtin files (if you still use them)
    if (Sk.builtinFiles && Sk.builtinFiles['files']) {
      const builtins = Sk.builtinFiles['files'];
      if (builtins[filename]) return builtins[filename];
    }

    throw new Error('File not found: ' + filename);
  }

  const __fileDict = Object.entries(filesMap)
    .map(([name, content]) => `"${name}": ${JSON.stringify(content)}`)
    .join(',\n  ');

  const injectedPython = `
__files__ = {
  ${__fileDict}
}

class FakeFile:
    def __init__(self, name, content):
        self.lines = content.splitlines(True)
        self.index = 0
        self.closed = False
        self.name = name
        self.content = content

    def read(self):
        return ''.join(self.lines[self.index:])

    def readline(self):
        if self.index < len(self.lines):
            line = self.lines[self.index]
            self.index += 1
            return line
        return ''

    def write(self, s):
        self.content += s
        print("##FILEWRITE## {} {}".format(self.name, self.content))
        __files__[self.name] += s

    def close(self):
        self.closed = True

    def __iter__(self):
        for line in self.lines[self.index:]:
            yield line

def open(filename, mode='r'):
    if 'w' in mode:
        __files__[filename] = ""
        return FakeFile(filename, "")
    elif filename in __files__:
        return FakeFile(filename, __files__[filename])
    else:
        raise FileNotFoundError("No such file: {}".format(filename))

`;

  const finalCode = injectedPython + '\n' + code;
  const injectedLineCount = (injectedPython.match(/\n/g) || []).length + 1;

  Sk.python3 = true;

  Sk.configure({
    output: (txt) => {
      if (txt.startsWith('##FILEWRITE## ')) {
        const payload = txt.slice('##FILEWRITE## '.length);
        const spaceIndex = payload.indexOf(' ');
        if (spaceIndex !== -1) {
          const filename = payload.slice(0, spaceIndex);
          const content = payload.slice(spaceIndex + 1);

          // ✅ update local fileContents for this client
          if (setFileContents) {
            setFileContents((prev) => ({
              ...prev,
              [filename]: content,
            }));
          }

          // ✅ NEW: let caller broadcast / mirror to others (no DB)
          if (typeof onFileWrite === 'function') {
            try {
              onFileWrite(filename, content);
            } catch (err) {
              console.error('onFileWrite error:', err);
            }
          }
        }
      } else {
        setOutput((prev) => prev + txt);
      }
    },

    // 🔑 NEW: hook imports into our virtual files
    read: readFromVfs,

    // Put the input prompt in the dialog box
    inputfun: (promptText) => {
      if (promptText) setOutput((prev) => prev + String(promptText));
      if (stdin && typeof stdin.readLine === 'function') return stdin.readLine();
      const val = window.prompt(promptText ?? '') ?? '';
      return Promise.resolve(val);
    },
    inputfunTakesPrompt: true,

    __future__: {
      python3: true,
      nested_scopes: true,
      generators: true,
      division: true,
      absolute_import: true,
      with_statement: true,
      print_function: true,
      unicode_literals: true,
      generator_stop: true,
      annotations: true,
      barry_as_FLUFL: true,
      braces: false,
      generator_exp: true,
      importlib: true,
      optimizations: true,
      top_level_await: true,
      variable_annotations: true,
      class_repr: true,
      inherit_from_object: true,
      super_args: true,
      octal_number_literal: true,
      bankers_rounding: true,
      python_version: true,
      dunder_round: true,
      exceptions: true,
      no_long_type: true,
      ceil_floor_int: true,
      silent_octal_literal: true,
    },
  });

  function formatSkErrorOffset(e, offset) {
    try {
      if (e && Array.isArray(e.traceback) && e.traceback.length) {
        const tb = e.traceback;
        const lines = ['Traceback (most recent call last):'];
        for (let i = tb.length - 1; i >= 0; i--) {
          const f = tb[i];
          const file = f.filename || '<stdin>';
          const func = f.func || '<module>';
          const isUser = /<stdin>(?:\.py)?$/i.test(file);
          const lineno = Math.max(
            1,
            (f.lineno || 1) - (isUser ? offset : 0)
          );
          lines.push(`  File "${file}", line ${lineno}, in ${func}`);
        }

        const msgRaw = e.toString ? e.toString() : e.message || String(e);
        const msg = msgRaw.replace(/(on line\s+)(\d+)/gi, (_, p, n) =>
          p + Math.max(1, parseInt(n, 10) - offset)
        );

        return lines.join('\n') + '\n' + msg;
      }

      const raw = Sk.misceval.printError
        ? Sk.misceval.printError(e)
        : String(e);
      return raw
        .replace(/(File\s+"<stdin>(?:\.py)?",\s+line\s+)(\d+)/gi, (_, p, n) =>
          p + Math.max(1, parseInt(n, 10) - offset)
        )
        .replace(/(on line\s+)(\d+)/gi, (_, p, n) =>
          p + Math.max(1, parseInt(n, 10) - offset)
        );
    } catch {
      return Sk.misceval.printError
        ? Sk.misceval.printError(e)
        : String(e);
    }
  }

// Turtle config (FIXED for multiple blocks)
if (turtleTargetId) {
  const mount = document.getElementById(turtleTargetId);
  if (mount) mount.innerHTML = '';

  // Ensure TurtleGraphics exists, then mutate fields (don't replace object)
  if (!window.Sk.TurtleGraphics) window.Sk.TurtleGraphics = {};
  window.Sk.TurtleGraphics.target = turtleTargetId;
  window.Sk.TurtleGraphics.width = turtleWidth;
  window.Sk.TurtleGraphics.height = turtleHeight;

  // Optional but helpful: keep turtle inside the mount
  if (mount) {
    mount.style.position = 'relative';
    mount.style.overflow = 'hidden';
  }
} else if (window.Sk && window.Sk.TurtleGraphics) {
  // If you want "no turtle", clear target safely
  window.Sk.TurtleGraphics.target = null;
}

  try {
    Sk.execLimit = execLimit;
    Sk.python3 = true;
    await Sk.misceval.asyncToPromise(() =>
      Sk.importMainWithBody('<stdin>', false, finalCode, true)
    );
  } catch (e) {
    const errText = formatSkErrorOffset(e, injectedLineCount);
    setOutput((prev) => prev + '\n❌ Error:\n' + errText);
  }
}
