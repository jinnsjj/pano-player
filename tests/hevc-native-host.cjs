const vscode = require('vscode');
const fs = require('node:fs/promises');

exports.run = async () => {
  const extension = vscode.extensions.getExtension('shijunjie.pano-player');
  await extension.activate();
  await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(process.env.PANO_PLAYER_TEST_VIDEO), 'panoPlayer.player');
  await fs.writeFile(process.env.PANO_PLAYER_TEST_READY, JSON.stringify({ version: extension.packageJSON.version }));
  const until = Date.now() + 600000;
  while (Date.now() < until) {
    try { await fs.access(process.env.PANO_PLAYER_TEST_DONE); return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('HEVC native test timed out');
};
