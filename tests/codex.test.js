const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildPrompt, run } = require('../codex');

function invoke(prompt = 'Hello', options = '{}', behavior = {}) {
  let call;
  let outputFile;
  const output = run(prompt, options, {
    platform: 'linux',
    spawnSync(command, args, opts) {
      call = { command, args, opts };
      outputFile = args[args.indexOf('--output-last-message') + 1];
      if (!behavior.missing) fs.writeFileSync(outputFile, behavior.output ?? 'Final answer');
      return behavior.result || { status: 0, stdout: 'progress and tool output', stderr: 'diagnostics' };
    }
  });
  assert.equal(fs.existsSync(path.dirname(outputFile)), false);
  return { output, ...call };
}

test('provider sends literal text on stdin, isolates final output, and uses safe flags', () => {
  const prompt = '-leading flag "quotes"\n$(touch never) & %PATH%';
  const result = invoke(prompt);
  assert.equal(result.command, 'codex');
  assert.equal(result.opts.input, prompt);
  assert.equal(result.opts.shell, undefined);
  assert.equal(result.args.includes(prompt), false);
  assert.equal(result.args.at(-1), '-');
  assert.deepEqual(result.args.slice(0, 7), [
    'exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--color', 'never', '--output-last-message'
  ]);
  assert.equal(result.args.includes('--model'), false);
  assert.equal(result.output, 'Final answer');
});

test('both modes honor model overrides and grader preserves every message in order', () => {
  const messages = [
    { role: 'system', content: 'Evaluate; return JSON' },
    { role: 'user', content: 'First response' },
    { role: 'assistant', content: 'Earlier judgment' },
    { role: 'user', content: 'Second response' }
  ];
  for (const prompt of ['Hello', JSON.stringify(messages)]) {
    const result = invoke(prompt, '{"config":{"model":" custom-model "}}');
    assert.equal(result.args[result.args.indexOf('--model') + 1], 'custom-model');
  }
  assert.equal(invoke(JSON.stringify(messages)).opts.input,
    'system:\nEvaluate; return JSON\n\nuser:\nFirst response\n\nassistant:\nEarlier judgment\n\nuser:\nSecond response');
});

test('non-chat JSON remains unchanged', () => {
  for (const prompt of ['[]', '{"query":"hi"}', '[1,2]', 'null']) {
    assert.equal(buildPrompt(prompt), prompt);
  }
});

test('invalid prompts, chat contents and options fail before launch', () => {
  const runtime = { spawnSync() { assert.fail('must not spawn'); } };
  for (const prompt of [undefined, '', '  ']) {
    assert.throws(() => run(prompt, '{}', runtime), /non-empty prompt/);
  }
  assert.throws(() => run('[{"role":"user","content":[]}]', '{}', runtime), /string role and content/);
  for (const options of ['{', '{"config":[]}', '{"config":{"model":""}}',
    '{"config":{"model":123}}', '{"config":{"model":"  "}}']) {
    assert.throws(() => run('Hello', options, runtime), /Invalid Codex provider options/);
  }
});

test('launch failures, nonzero exits, signals and missing output clean up temporary files', () => {
  for (const scenario of [
    { result: { error: new Error('ENOENT') }, error: /ENOENT/ },
    { result: { status: 2, stderr: 'authentication failed', stdout: 'noise' }, error: /authentication failed/ },
    { result: { status: null, signal: 'SIGTERM' }, error: /SIGTERM/ },
    { result: { status: 0 }, error: /did not produce/ },
    { result: { status: 0 }, output: '  ', error: /empty final response/ }
  ]) {
    let directory;
    assert.throws(() => run('Hi', '{}', {
      platform: 'linux',
      spawnSync(command, args) {
        const file = args[args.indexOf('--output-last-message') + 1];
        directory = path.dirname(file);
        if (scenario.output !== undefined) fs.writeFileSync(file, scenario.output);
        return scenario.result;
      }
    }), scenario.error);
    assert.equal(fs.existsSync(directory), false);
  }
});

test('Windows npm installation launches through Node, not a shell', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-windows-test-'));
  const entry = path.join(directory, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(entry, '');
  try {
    let calls = 0;
    const output = run('Hello & goodbye', '{}', {
      platform: 'win32',
      spawnSync(command, args, opts) {
        if (calls++ === 0) {
          assert.equal(command, 'where.exe');
          return { status: 0, stdout: `${path.join(directory, 'codex.cmd')}\r\n` };
        }
        assert.equal(command, process.execPath);
        assert.equal(args[0], entry);
        assert.equal(opts.shell, undefined);
        assert.equal(opts.input, 'Hello & goodbye');
        fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], 'Windows answer');
        return { status: 0 };
      }
    });
    assert.equal(output, 'Windows answer');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('missing Windows installation gives actionable diagnostics', () => {
  assert.throws(() => run('Hi', '{}', {
    platform: 'win32', spawnSync: () => ({ status: 1, stdout: '' })
  }), /install @openai\/codex/);
});

test('CLI entry point reports input errors only on stderr with a failing exit', () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../codex.js')], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /non-empty prompt/);
});
