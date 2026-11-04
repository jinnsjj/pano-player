const assert = require('node:assert/strict');
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.run = async () => {
  const uri = vscode.Uri.file(process.env.PANO_PLAYER_TEST_VIDEO);
  const json = vscode.Uri.file(path.join(path.dirname(uri.fsPath), 'ordinary.json'));
  await fs.copyFile(uri.fsPath, json.fsPath);
  await vscode.commands.executeCommand('vscode.open', json);
  assert.equal(vscode.window.activeTextEditor?.document.uri.toString(), json.toString());
  assert.equal(vscode.window.activeTextEditor.document.languageId, 'json');
  assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab.input instanceof vscode.TabInputText);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  // Use the normal resolver so this checks the default rather than forcing Open With.
  await vscode.commands.executeCommand('vscode.open', uri);
  const input = vscode.window.tabGroups.activeTabGroup.activeTab.input;
  assert.ok(input instanceof vscode.TabInputCustom);
  assert.equal(input.viewType, 'panoPlayer.mediaConfig');
  assert.equal(input.uri.toString(), uri.toString());
  const extension = vscode.extensions.getExtension('shijunjie.pano-player');
  await fs.writeFile(process.env.PANO_PLAYER_TEST_READY, JSON.stringify({ version: extension.packageJSON.version, defaultEditor: input.viewType, ordinaryJsonEditor: 'text' }));
  const until = Date.now() + 600000;
  while (Date.now() < until) {
    try { await fs.access(process.env.PANO_PLAYER_TEST_DONE); return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('JSONPP native test timed out');
};
