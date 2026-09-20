const vscode = require('vscode');
const fs = require('node:fs/promises');
exports.run = async () => {
  process.env.PATH = '/usr/bin:/bin';
  const extension = vscode.extensions.getExtension('shijunjie.pano-player');
  if (!extension) throw new Error('Extension not installed');
  await extension.activate();
  await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(process.env.PANO_PLAYER_TEST_VIDEO), 'panoPlayer.player');
  await fs.writeFile('/tmp/pano-player-host-ready.json', JSON.stringify({ active: extension.isActive, version: extension.packageJSON.version, path: process.env.PATH, defaultSettings: true }));
  // Keep the Extension Development Host alive for external browser/CDP QA.
  await new Promise(resolve => setTimeout(resolve, 900000));
};
