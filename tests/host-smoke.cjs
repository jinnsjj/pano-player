const vscode = require('vscode');
const fs = require('node:fs/promises');
exports.run = async () => {
  const config = vscode.workspace.getConfiguration('foaPowermap');
  for (const key of ['pythonPath', 'ffmpegPath', 'ffprobePath']) {
    if (config.inspect(key).globalValue !== undefined) throw new Error(`Test requires default settings: ${key}`);
  }
  process.env.PATH = '/usr/bin:/bin';
  const extension = vscode.extensions.getExtension('spatial-audio-tools.foa-powermap-player');
  if (!extension) throw new Error('Extension not installed');
  await extension.activate();
  await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(process.env.FOA_TEST_VIDEO), 'foaPowermap.player');
  await fs.writeFile('/tmp/foa-powermap-host-ready.json', JSON.stringify({ active: extension.isActive, version: extension.packageJSON.version, path: process.env.PATH, defaultSettings: true }));
  // Keep the Extension Development Host alive for external browser/CDP QA.
  await new Promise(resolve => setTimeout(resolve, 900000));
};
