#!/usr/bin/env node
// Combined Codex CLI provider and grader for promptfoo.
// Plain text is provider input; JSON chat arrays are grader input.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function buildPrompt(prompt) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new Error('Codex requires a non-empty prompt');
  }
  let messages;
  try {
    messages = JSON.parse(prompt);
  } catch {
    return prompt;
  }
  if (!Array.isArray(messages) || !messages.length || !messages[0]?.role) {
    return prompt;
  }
  return messages.map(message => {
    if (typeof message.role !== 'string' || typeof message.content !== 'string') {
      throw new Error('Codex grader messages require string role and content fields');
    }
    return `${message.role}:\n${message.content}`;
  }).join('\n\n');
}

function run(prompt, options = '{}', runtime = {}) {
  const spawn = runtime.spawnSync || spawnSync;
  const platform = runtime.platform || process.platform;
  const input = buildPrompt(prompt);
  let config;
  try {
    const parsed = JSON.parse(options);
    config = parsed?.config ?? {};
    if (typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('config must be an object');
    }
    if (config.model !== undefined &&
        (typeof config.model !== 'string' || !config.model.trim())) {
      throw new Error('config.model must be a non-empty string');
    }
  } catch (error) {
    throw new Error(`Invalid Codex provider options: ${error.message}`);
  }

  let command = 'codex';
  let prefix = [];
  if (platform === 'win32') {
    // Shell-free Windows launcher contract: see codex.SPEC.md.
    const located = spawn('where.exe', ['codex'], { encoding: 'utf8' });
    const candidates = (located.stdout || '').trim().split(/\r?\n/);
    const native = candidates.find(file => /\.exe$/i.test(file) && fs.existsSync(file));
    const entry = candidates.map(file => path.join(path.dirname(file),
      'node_modules', '@openai', 'codex', 'bin', 'codex.js')).find(file => fs.existsSync(file));
    if (native) {
      command = native;
    } else if (entry) {
      command = process.execPath;
      prefix = [entry];
    } else {
      throw new Error('Cannot locate Codex on Windows; install @openai/codex with npm and add it to PATH');
    }
  }

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'promptfoo-codex-'));
  const outputFile = path.join(directory, 'response.txt');
  try {
    const args = [...prefix, 'exec', '--sandbox', 'read-only', '--skip-git-repo-check',
      '--color', 'never', '--output-last-message', outputFile];
    if (config.model !== undefined) args.push('--model', config.model.trim());
    args.push('-');
    const result = spawn(command, args, {
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024
    });
    if (result.error) throw new Error(`Unable to run Codex: ${result.error.message}`);
    if (result.status !== 0) {
      throw new Error(`Codex failed (${result.signal || result.status}): ${
        result.stderr?.trim() || result.stdout?.trim() || 'no diagnostics'}`);
    }
    if (!fs.existsSync(outputFile)) throw new Error('Codex did not produce a final response');
    const output = fs.readFileSync(outputFile, 'utf8');
    if (!output.trim()) throw new Error('Codex returned an empty final response');
    return output;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    console.log(run(process.argv[2], process.argv[3]));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildPrompt, run };
